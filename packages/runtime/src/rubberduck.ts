import {
  Requirements,
  Decision,
  QuestionType,
  RubberduckQuestion,
  RubberduckDriver,
} from '@volibear/contracts';
import { EventLog, ArtifactStore, BlockingQuestionError } from '@volibear/core';

export type { QuestionType, RubberduckQuestion, RubberduckDriver };

// ── Answer source ──────────────────────────────────────

export type AnswerSource = 'user' | 'delegated';

export type RubberduckState =
  | 'DISCOVERING'
  | 'QUESTIONS_PENDING'
  | 'ANSWERS_INCOMPLETE'
  | 'REVIEW'
  | 'LOCKED';

// ── Session state machine ──────────────────────────────
// States: DISCOVERING → QUESTIONS_PENDING → ANSWERS_INCOMPLETE → REVIEW → LOCKED
// The runtime decides whether unresolved blocking questions remain — never the model.

const VALID_TRANSITIONS: Record<RubberduckState, RubberduckState[]> = {
  DISCOVERING: ['QUESTIONS_PENDING'],
  QUESTIONS_PENDING: ['ANSWERS_INCOMPLETE', 'REVIEW'],
  ANSWERS_INCOMPLETE: ['ANSWERS_INCOMPLETE', 'REVIEW'],
  REVIEW: ['ANSWERS_INCOMPLETE', 'LOCKED'],
  LOCKED: [],
};

export class RubberduckSession {
  private state: RubberduckState = 'DISCOVERING';
  private questions: RubberduckQuestion[] = [];
  private task: string;

  constructor(
    private runId: string,
    private driver: RubberduckDriver,
    private events: EventLog,
    private artifacts: ArtifactStore,
    task: string,
  ) {
    this.task = task;
  }

  getState(): RubberduckState {
    return this.state;
  }

  getQuestions(): RubberduckQuestion[] {
    return [...this.questions];
  }

  private transition(next: RubberduckState): void {
    const from = this.state;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(next)) {
      throw new Error(
        `invalid Rubberduck transition ${from} → ${next}`,
      );
    }
    this.state = next;
    this.events.record('rubberduck.state.changed', this.runId, {
      from,
      to: next,
    });
  }

  /**
   * Run discovery: the driver inspects the task and produces questions.
   */
  async discover(context: { findings?: unknown } = {}): Promise<RubberduckQuestion[]> {
    if (this.state !== 'DISCOVERING') {
      throw new Error(`discover() called in state ${this.state}`);
    }
    this.questions = await this.driver.discover(this.task, context);
    for (const q of this.questions) {
      this.events.record('rubberduck.question.created', this.runId, {
        id: q.id,
        type: q.type,
      });
    }
    this.transition('QUESTIONS_PENDING');
    return this.getQuestions();
  }

  /**
   * Submit an answer for a question.
   * Returns true if the session transitioned to REVIEW (all blocking answered).
   * Throws if the question id is unknown.
   */
  submitAnswer(questionId: string, input: string): {
    reviewReady: boolean;
    question: RubberduckQuestion;
  } {
    const q = this.questions.find((x) => x.id === questionId);
    if (!q) {
      throw new Error(`unknown question "${questionId}"`);
    }
    this.events.record('rubberduck.question.answered', this.runId, {
      id: questionId,
      source: 'user',
    });
    q.answer = input;
    q.answer_source = 'user';
    q.selected_by = 'user';
    q.approved_by_user = true;

    const ready = this.allBlockingAnswered();
    this.transition(ready ? 'REVIEW' : 'ANSWERS_INCOMPLETE');
    return { reviewReady: ready, question: { ...q } };
  }

  /**
   * Delegate a decision to the driver (user typed "decide for me").
   */
  async delegate(questionId: string): Promise<RubberduckQuestion> {
    const q = this.questions.find((x) => x.id === questionId);
    if (!q) {
      throw new Error(`unknown question "${questionId}"`);
    }
    const decision = await this.driver.decide(q, this.task);
    q.answer = decision.answer;
    q.answer_source = 'delegated';
    q.selected_by = decision.selectedBy;
    q.approved_by_user = true;
    this.events.record('rubberduck.question.answered', this.runId, {
      id: questionId,
      source: 'delegated',
      selected_by: decision.selectedBy,
    });

    const ready = this.allBlockingAnswered();
    this.transition(ready ? 'REVIEW' : 'ANSWERS_INCOMPLETE');
    return { ...q };
  }

  /**
   * Deterministic check: are all BLOCKING questions answered?
   * This is the core strictness rule. The runtime decides this, never the model.
   */
  allBlockingAnswered(): boolean {
    return this.blockingUnresolved().length === 0;
  }

  /**
   * List blocking questions that have no answer.
   */
  blockingUnresolved(): RubberduckQuestion[] {
    return this.questions.filter(
      (q) => q.type === 'BLOCKING' && q.answer === undefined,
    );
  }

  /**
   * Return the requirements draft (for REVIEW state).
   */
  async reviewDraft(): Promise<Requirements> {
    if (this.state !== 'REVIEW') {
      throw new Error(`reviewDraft() called in state ${this.state}`);
    }
    const requirements = await this.driver.generateRequirements(this.task, this.questions);
    this.artifacts.write('requirements', requirements);
    return requirements;
  }

  /**
   * Lock the requirements. Refuses while any blocking question is unresolved.
   * The runtime (not the model) decides whether all blocking questions are answered.
   */
  async lock(): Promise<Requirements> {
    const unresolved = this.blockingUnresolved();
    if (unresolved.length > 0) {
      throw new BlockingQuestionError(unresolved.length);
    }
    if (this.state !== 'REVIEW') {
      throw new Error(`lock() called in state ${this.state}`);
    }

    const requirements = await this.reviewDraft();
    // Persist the lock file
    this.artifacts.writeRaw(
      'requirements.lock',
      JSON.stringify(requirements, null, 2),
    );
    this.events.record('requirements.locked', this.runId, {
      version: requirements.version,
    });
    this.transition('LOCKED');
    return requirements;
  }

  /**
   * Headless/automated flow: discover, answer every blocking question
   * through the driver, and lock. Used by the mock runtime; the interactive
   * CLI replaces this with real user answers. Strictly refuses to lock if any
   * blocking question remains unresolved.
   */
  async runToLocked(context: { findings?: unknown } = {}): Promise<Requirements> {
    await this.discover(context);

    // Resolve every blocking question through the driver. If the driver leaves
    // any unresolved, lock() throws — the pipeline cannot proceed.
    for (const q of this.blockingUnresolved()) {
      await this.delegate(q.id);
    }

    // Transition into REVIEW happens via delegate/submitAnswer above.
    return this.lock();
  }

  toDecisions(): Decision[] {
    return this.questions
      .filter((q) => q.answer !== undefined)
      .map((q) => ({
        id: q.id,
        question: q.text,
        answer: q.answer!,
        answer_source: (q.answer_source ?? 'user') as Decision['answer_source'],
        selected_by: q.selected_by,
        approved_by_user: q.approved_by_user ?? true,
      }));
  }
}

// ── Stage runner glue ──────────────────────────────────

/**
 * Runs the rubberduck stage to completion (LOCKED).
 */
export async function runRubberduck(
  runId: string,
  opts: {
    events: EventLog;
    artifacts: ArtifactStore;
    task: string;
    driver?: RubberduckDriver;
    findings?: unknown;
  },
): Promise<{ kind: 'continue' } | { kind: 'fail'; error: string }> {
  if (!opts.driver) {
    return { kind: 'fail', error: 'no rubberduck driver configured' };
  }
  const session = new RubberduckSession(
    runId,
    opts.driver,
    opts.events,
    opts.artifacts,
    opts.task,
  );
  try {
    await session.runToLocked({ findings: opts.findings });
    return { kind: 'continue' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'fail', error: message };
  }
}
