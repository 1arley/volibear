import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Executor,
  ExecutorContext,
  ExecutorResult,
  Requirements,
  RubberduckDriver,
  RubberduckQuestion,
} from '@volibear/contracts';

/**
 * Mock executor — deterministic stand-in for LLM-backed coding CLIs.
 * Each agent role produces a deterministic artifact. No LLM involved.
 *
 * The reviewer can be scripted to reject with findings on early passes and
 * approve only after the fixer has run, which exercises the repair loop.
 */
export class MockExecutor implements Executor {
  readonly id = 'mock';
  readonly capabilities = {
    headless: true,
    interactive: false,
    filesystem: true,
    tools: false,
    custom_endpoint: false,
    structured_output: true,
  };

  constructor(private options?: {
    /** Reviewer rejects with these findings until the fixer has run. */
    rejectFindings?: Array<{
      id: string;
      severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
      title: string;
      recommendation?: string;
    }>;
    /** Reviewer rejects on every pass, even after the fixer ran. */
    alwaysReject?: boolean;
  }) {}

  async detect(): Promise<boolean> {
    return true;
  }

  async runAgent(ctx: ExecutorContext): Promise<ExecutorResult> {
    switch (ctx.agent) {
      case 'architect':
        return this.architect(ctx);
      case 'developer':
        return this.developer(ctx);
      case 'reviewer':
        return this.reviewer(ctx);
      case 'fixer':
        return this.fixer(ctx);
      case 'verifier':
        return this.verifier(ctx);
      default:
        return {
          exitCode: 0,
          stdout: `[mock] ${ctx.agent} did nothing (unknown role)`,
          stderr: '',
        };
    }
  }

  async runCommand(ctx: ExecutorContext): Promise<ExecutorResult> {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(ctx.task, {
      cwd: ctx.cwd,
      shell: true,
      encoding: 'utf-8',
    });
    return {
      exitCode: res.status ?? 1,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    };
  }

  // ── Role behaviors ────────────────────────────────────

  private architect(ctx: ExecutorContext): ExecutorResult {
    const requirements = readRequirements(ctx.runDir);
    const content = [
      '# Architecture',
      '',
      '## Summary',
      `Implement the task: ${requirements?.task ?? ctx.task}`,
      '',
      '## Files',
      '- src/implementation.txt (created)',
      '',
      '## Approach',
      'Use the mock executor to produce deterministic output.',
    ].join('\n');
    writeRaw(ctx.runDir, 'architecture.md', content);
    writeJson(ctx.runDir, 'architecture.json', {
      version: 1,
      requirements_version: requirements?.version ?? 1,
      summary: `Implement: ${requirements?.task ?? ctx.task}`,
      files_to_create: ['src/implementation.txt'],
      files_to_modify: [],
      approach: 'Mock deterministic architecture',
      risks: [],
      acceptance_criteria: [],
    });
    return {
      exitCode: 0,
      stdout: '[mock] architect produced architecture.md',
      stderr: '',
    };
  }

  private developer(ctx: ExecutorContext): ExecutorResult {
    // Write the mock implementation into the RUN directory (sandbox), never
    // into the user's project working tree.
    const file = join(ctx.runDir, 'implementation.txt');
    writeRaw(ctx.runDir, 'implementation.txt', 'Mock implementation produced by volibear.\n');
    writeJson(ctx.runDir, 'implementation.json', {
      files_created: ['implementation.txt'],
      files_changed: [],
      files_deleted: [],
      summary: 'Mock implementation',
    });
    return {
      exitCode: 0,
      stdout: `[mock] developer wrote ${file}`,
      stderr: '',
    };
  }

  private reviewer(ctx: ExecutorContext): ExecutorResult {
    const fixerRan = implementationHasFixerMark(ctx.runDir);
    const rejectOnEveryPass = this.options?.alwaysReject === true;
    const findings = this.options?.rejectFindings && (!fixerRan || rejectOnEveryPass)
      ? this.options.rejectFindings
      : [];
    const approved = findings.length === 0;
    writeJson(ctx.runDir, 'review.json', {
      version: 1,
      approved,
      findings,
      summary: approved
        ? 'Mock review: no findings'
        : `Mock review: ${findings.length} finding(s) before fixer`,
    });
    return {
      exitCode: 0,
      stdout: approved ? '[mock] reviewer approved' : '[mock] reviewer rejected',
      stderr: '',
    };
  }

  private fixer(ctx: ExecutorContext): ExecutorResult {
    writeJson(ctx.runDir, 'implementation.json', {
      files_created: ['implementation.txt'],
      files_changed: [],
      files_deleted: [],
      summary: 'Mock fixer applied',
      _fixer_mark: true,
    });
    return {
      exitCode: 0,
      stdout: '[mock] fixer applied fixes',
      stderr: '',
    };
  }

  private verifier(ctx: ExecutorContext): ExecutorResult {
    writeJson(ctx.runDir, 'verification.json', {
      commands: [],
      passed: true,
      summary: 'Mock verification passed',
    });
    return {
      exitCode: 0,
      stdout: '[mock] verifier passed',
      stderr: '',
    };
  }
}

// ── Mock Rubberduck driver ─────────────────────────────
// Produces deterministic questions and requirements. An LLM-backed driver
// would behave similarly but generate questions from the task text.

export class MockRubberduckDriver implements RubberduckDriver {
  readonly id = 'mock-rubberduck';

  constructor(private options?: {
    blockingQuestions?: string[];
    optionalQuestions?: string[];
    inferableQuestions?: string[];
    /** Set to true to leave blocking questions unanswered (tests strictness) */
    leaveBlockingUnanswered?: boolean;
  }) {}

  async discover(
    task: string,
    _context: { findings?: unknown } = {},
  ): Promise<RubberduckQuestion[]> {
    const questions: RubberduckQuestion[] = [];
    const blocking = this.options?.blockingQuestions ?? [
      'Should existing behavior be preserved?',
    ];
    const optional = this.options?.optionalQuestions ?? [
      'Prefer conventional commit messages?',
    ];
    const inferable = this.options?.inferableQuestions ?? [
      'Use the project language for new code?',
    ];

    blocking.forEach((text, i) => {
      questions.push({ id: `Q${i + 1}`, text, type: 'BLOCKING' });
    });
    optional.forEach((text, i) => {
      questions.push({
        id: `Q${blocking.length + i + 1}`,
        text,
        type: 'OPTIONAL',
      });
    });
    inferable.forEach((text, i) => {
      questions.push({
        id: `Q${blocking.length + optional.length + i + 1}`,
        text,
        type: 'INFERABLE',
      });
    });
    return questions;
  }

  async decide(
    question: RubberduckQuestion,
    _task: string,
  ): Promise<{ answer: string; selectedBy: string }> {
    return {
      answer: `(delegated default) ${question.text}`,
      selectedBy: 'rubberduck',
    };
  }

  async generateRequirements(
    task: string,
    questions: RubberduckQuestion[],
  ): Promise<Requirements> {
    const answered = questions.filter((q) => q.answer !== undefined);
    return {
      version: 1,
      task,
      decisions: answered.map((q) => ({
        id: q.id,
        question: q.text,
        answer: q.answer!,
        answer_source: q.answer_source === 'delegated' ? 'delegated' : 'user',
        selected_by: q.selected_by,
        approved_by_user: true,
      })),
      assumptions: [],
      constraints: [],
      acceptance_intent: [],
      unresolved: questions
        .filter((q) => q.type === 'BLOCKING' && q.answer === undefined)
        .map((q) => ({ id: q.id, question: q.text, type: 'BLOCKING' as const })),
    };
  }
}

// ── Helpers ────────────────────────────────────────────

function readRequirements(runDir: string): Requirements | null {
  try {
    const raw = readFileSync(join(runDir, 'requirements.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function implementationHasFixerMark(runDir: string): boolean {
  try {
    const raw = readFileSync(join(runDir, 'implementation.json'), 'utf-8');
    return JSON.parse(raw)._fixer_mark === true;
  } catch {
    return false;
  }
}

function writeJson(runDir: string, filename: string, data: unknown): void {
  writeFileSync(join(runDir, filename), JSON.stringify(data, null, 2), 'utf-8');
}

function writeRaw(runDir: string, filename: string, content: string): void {
  writeFileSync(join(runDir, filename), content, 'utf-8');
}
