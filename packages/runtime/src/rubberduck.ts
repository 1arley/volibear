import {
  Decision,
  QuestionType,
  Requirements,
  RequirementsSchema,
  RubberduckDriver,
  RubberduckInteraction,
  RubberduckQuestion,
  RubberduckSnapshot,
  RubberduckSnapshotSchema,
  RubberduckState,
} from '@volibear/contracts';
import { ArtifactStore, BlockingQuestionError, EventLog } from '@volibear/core';

export type {
  QuestionType,
  RubberduckDriver,
  RubberduckInteraction,
  RubberduckQuestion,
  RubberduckSnapshot,
  RubberduckState,
};

const VALID_TRANSITIONS: Record<RubberduckState, RubberduckState[]> = {
  DISCOVERING: ['QUESTIONS_PENDING'],
  QUESTIONS_PENDING: ['ANSWERS_INCOMPLETE', 'REVIEW'],
  ANSWERS_INCOMPLETE: ['ANSWERS_INCOMPLETE', 'REVIEW'],
  REVIEW: ['ANSWERS_INCOMPLETE', 'LOCKED'],
  LOCKED: [],
};

export type InteractiveRubberduckResult =
  | { kind: 'locked'; requirements: Requirements }
  | { kind: 'waiting'; reason: string };

/**
 * Strict discovery state machine. The driver proposes questions and defaults;
 * this class alone decides whether the workflow may lock requirements.
 */
export class RubberduckSession {
  private state: RubberduckState;
  private questions: RubberduckQuestion[];
  private readonly task: string;

  constructor(
    private readonly runId: string,
    private readonly driver: RubberduckDriver,
    private readonly events: EventLog,
    private readonly artifacts: ArtifactStore,
    task: string,
    snapshot?: RubberduckSnapshot,
  ) {
    if (snapshot) {
      const restored = RubberduckSnapshotSchema.parse(snapshot);
      if (restored.task !== task) {
        throw new Error('discovery snapshot task does not match the run task');
      }
      this.state = restored.state;
      this.questions = restored.questions.map((question) => ({ ...question }));
      this.task = restored.task;
    } else {
      this.state = 'DISCOVERING';
      this.questions = [];
      this.task = task;
      this.persist();
    }
  }

  getState(): RubberduckState {
    return this.state;
  }

  getQuestions(): RubberduckQuestion[] {
    return this.questions.map((question) => ({ ...question }));
  }

  snapshot(): RubberduckSnapshot {
    return {
      version: 1,
      state: this.state,
      task: this.task,
      questions: this.getQuestions(),
      updated_at: new Date().toISOString(),
    };
  }

  private persist(): void {
    this.artifacts.write('discovery', this.snapshot());
  }

  private transition(next: RubberduckState): void {
    const from = this.state;
    if (!VALID_TRANSITIONS[from].includes(next)) {
      throw new Error(`invalid Rubberduck transition ${from} → ${next}`);
    }
    this.state = next;
    this.events.record('rubberduck.state.changed', this.runId, { from, to: next });
    this.persist();
  }

  /** Ask the driver to discover decisions required for the task. */
  async discover(context: { findings?: unknown } = {}): Promise<RubberduckQuestion[]> {
    if (this.state !== 'DISCOVERING') {
      throw new Error(`discover() called in state ${this.state}`);
    }

    this.questions = await this.driver.discover(this.task, context);
    const ids = new Set<string>();
    for (const question of this.questions) {
      if (ids.has(question.id)) {
        throw new Error(`duplicate Rubberduck question id "${question.id}"`);
      }
      ids.add(question.id);
      this.events.record('rubberduck.question.created', this.runId, {
        id: question.id,
        type: question.type,
      });
    }

    this.transition('QUESTIONS_PENDING');
    if (this.allBlockingAnswered()) {
      this.transition('REVIEW');
    }
    return this.getQuestions();
  }

  /** Record one exact answer without inferring answers for other questions. */
  submitAnswer(
    questionId: string,
    input: string,
  ): { reviewReady: boolean; question: RubberduckQuestion } {
    if (!['QUESTIONS_PENDING', 'ANSWERS_INCOMPLETE'].includes(this.state)) {
      throw new Error(`submitAnswer() called in state ${this.state}`);
    }
    if (!input.trim()) {
      throw new Error('answer cannot be empty');
    }

    const question = this.requireQuestion(questionId);
    question.answer = input.trim();
    question.answer_source = 'user';
    question.selected_by = 'user';
    question.approved_by_user = true;
    this.events.record('rubberduck.question.answered', this.runId, {
      id: questionId,
      source: 'user',
    });

    const ready = this.allBlockingAnswered();
    this.transition(ready ? 'REVIEW' : 'ANSWERS_INCOMPLETE');
    return { reviewReady: ready, question: { ...question } };
  }

  /** Resolve one question using a driver-selected default approved by the user. */
  async delegate(questionId: string): Promise<RubberduckQuestion> {
    if (!['QUESTIONS_PENDING', 'ANSWERS_INCOMPLETE'].includes(this.state)) {
      throw new Error(`delegate() called in state ${this.state}`);
    }

    const question = this.requireQuestion(questionId);
    const decision = await this.driver.decide(question, this.task);
    if (!decision.answer.trim()) {
      throw new Error(`driver returned an empty delegated answer for "${questionId}"`);
    }

    question.answer = decision.answer.trim();
    question.answer_source = 'delegated';
    question.selected_by = decision.selectedBy;
    question.approved_by_user = true;
    this.events.record('rubberduck.question.answered', this.runId, {
      id: questionId,
      source: 'delegated',
      selected_by: decision.selectedBy,
    });

    const ready = this.allBlockingAnswered();
    this.transition(ready ? 'REVIEW' : 'ANSWERS_INCOMPLETE');
    return { ...question };
  }

  allBlockingAnswered(): boolean {
    return this.blockingUnresolved().length === 0;
  }

  blockingUnresolved(): RubberduckQuestion[] {
    return this.questions
      .filter((question) => question.type === 'BLOCKING' && question.answer === undefined)
      .map((question) => ({ ...question }));
  }

  async reviewDraft(): Promise<Requirements> {
    if (this.state !== 'REVIEW') {
      throw new Error(`reviewDraft() called in state ${this.state}`);
    }
    const generated = await this.driver.generateRequirements(this.task, this.getQuestions());
    const requirements = RequirementsSchema.parse(generated);
    this.artifacts.write('requirements', requirements);
    return requirements;
  }

  /** Create requirements.lock only after the deterministic blocking check passes. */
  async lock(draft?: Requirements): Promise<Requirements> {
    const unresolved = this.blockingUnresolved();
    if (unresolved.length > 0) {
      throw new BlockingQuestionError(unresolved.length);
    }
    if (this.state !== 'REVIEW') {
      throw new Error(`lock() called in state ${this.state}`);
    }

    const requirements = draft ?? await this.reviewDraft();
    this.artifacts.write('requirements', requirements);
    this.artifacts.writeRaw('requirements.lock', JSON.stringify(requirements, null, 2));
    this.events.record('requirements.locked', this.runId, { version: requirements.version });
    this.transition('LOCKED');
    return requirements;
  }

  /** Headless flow used by tests and explicit non-interactive execution. */
  async runToLocked(context: { findings?: unknown } = {}): Promise<Requirements> {
    if (this.state === 'LOCKED') {
      const existing = this.artifacts.read<Requirements>('requirements');
      if (!existing) throw new Error('locked discovery is missing requirements.json');
      return RequirementsSchema.parse(existing);
    }
    if (this.state === 'DISCOVERING') {
      await this.discover(context);
    }
    for (const question of this.blockingUnresolved()) {
      await this.delegate(question.id);
    }
    return this.lock();
  }

  /** Interactive flow that can pause and later resume from discovery.json. */
  async runInteractive(
    interaction: RubberduckInteraction,
    context: { findings?: unknown } = {},
  ): Promise<InteractiveRubberduckResult> {
    if (this.state === 'LOCKED') {
      const existing = this.artifacts.read<Requirements>('requirements');
      if (!existing) throw new Error('locked discovery is missing requirements.json');
      return { kind: 'locked', requirements: RequirementsSchema.parse(existing) };
    }
    if (this.state === 'DISCOVERING') {
      await this.discover(context);
    }

    while (!this.allBlockingAnswered()) {
      const unresolved = this.blockingUnresolved();
      const question = unresolved[0];
      const answer = await interaction.answer(question, unresolved.length);
      if (answer.kind === 'pause') {
        this.persist();
        return {
          kind: 'waiting',
          reason: `${unresolved.length} blocking question(s) remain unanswered`,
        };
      }
      if (answer.kind === 'delegate') {
        await this.delegate(question.id);
      } else {
        this.submitAnswer(question.id, answer.answer);
      }
    }

    const draft = await this.reviewDraft();
    if (!await interaction.confirmLock(draft)) {
      this.persist();
      return { kind: 'waiting', reason: 'requirements lock was not approved' };
    }
    return { kind: 'locked', requirements: await this.lock(draft) };
  }

  toDecisions(): Decision[] {
    return this.questions
      .filter((question) => question.answer !== undefined)
      .map((question) => ({
        id: question.id,
        question: question.text,
        answer: question.answer!,
        answer_source: question.answer_source ?? 'user',
        selected_by: question.selected_by,
        approved_by_user: question.approved_by_user ?? true,
      }));
  }

  private requireQuestion(questionId: string): RubberduckQuestion {
    const question = this.questions.find((candidate) => candidate.id === questionId);
    if (!question) throw new Error(`unknown question "${questionId}"`);
    return question;
  }
}

export type RubberduckStageResult =
  | { kind: 'continue' }
  | { kind: 'waiting-for-user'; reason: string }
  | { kind: 'fail'; error: string };

/** Run the Rubberduck stage using either a human interaction or headless defaults. */
export async function runRubberduck(
  runId: string,
  opts: {
    events: EventLog;
    artifacts: ArtifactStore;
    task: string;
    driver?: RubberduckDriver;
    interaction?: RubberduckInteraction;
    findings?: unknown;
  },
): Promise<RubberduckStageResult> {
  if (!opts.driver) return { kind: 'fail', error: 'no rubberduck driver configured' };

  try {
    const rawSnapshot = opts.artifacts.read<RubberduckSnapshot>('discovery');
    const snapshot = rawSnapshot ? RubberduckSnapshotSchema.parse(rawSnapshot) : undefined;
    const session = new RubberduckSession(
      runId,
      opts.driver,
      opts.events,
      opts.artifacts,
      opts.task,
      snapshot,
    );
    if (opts.interaction) {
      const result = await session.runInteractive(opts.interaction, { findings: opts.findings });
      return result.kind === 'waiting'
        ? { kind: 'waiting-for-user', reason: result.reason }
        : { kind: 'continue' };
    }
    await session.runToLocked({ findings: opts.findings });
    return { kind: 'continue' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'fail', error: message };
  } finally {
    opts.interaction?.close?.();
  }
}
