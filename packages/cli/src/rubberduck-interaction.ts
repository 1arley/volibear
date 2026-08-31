import { createInterface, Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  Requirements,
  RubberduckAnswer,
  RubberduckInteraction,
  RubberduckQuestion,
} from '@volibear/contracts';

/**
 * Terminal implementation of the human side of Rubberduck discovery.
 *
 * The readline interface is created lazily on first answer, so pipelines that
 * never reach the rubberduck stage do not hold an open TTY handle (which would
 * keep the process alive and hang it).
 */
export class TerminalRubberduckInteraction implements RubberduckInteraction {
  private readline: Interface | null = null;

  private ensureReadline(): Interface {
    if (!this.readline) {
      this.readline = createInterface({ input: stdin, output: stdout });
    }
    return this.readline;
  }

  async answer(
    question: RubberduckQuestion,
    remainingBlocking: number,
  ): Promise<RubberduckAnswer> {
    const rl = this.ensureReadline();
    console.log('\nRubberduck');
    console.log(`${remainingBlocking} blocking decision(s) remain.`);
    console.log(`\n${question.id} [${question.type}] ${question.text}`);
    const input = (await this.prompt(rl)).trim();
    if (input === '/delegate') return { kind: 'delegate' };
    if (input === '/pause') return { kind: 'pause' };
    if (!input) return this.answer(question, remainingBlocking);
    return { kind: 'answer', answer: input };
  }

  async confirmLock(requirements: Requirements): Promise<boolean> {
    const rl = this.ensureReadline();
    console.log('\nRequirements review');
    console.log(`Task: ${requirements.task}`);
    for (const decision of requirements.decisions) {
      console.log(`  ${decision.id}: ${decision.answer}`);
    }
    const input = (await this.prompt(rl)).trim().toLowerCase();
    return input === 'y' || input === 'yes';
  }

  close(): void {
    this.readline?.close();
    this.readline = null;
  }

  /**
   * EOF/Ctrl-D surfaces as an AbortError on the readline promise. Treat it as a
   * pause so partial discovery is preserved and the run stays resumable.
   */
  private async prompt(rl: Interface): Promise<string> {
    try {
      return await rl.question('');
    } catch {
      return '/pause';
    }
  }
}

/** Explicit opt-in non-interactive defaults, suitable for CI and tests. */
export class AcceptDefaultsInteraction implements RubberduckInteraction {
  async answer(): Promise<RubberduckAnswer> {
    return { kind: 'delegate' };
  }

  async confirmLock(): Promise<boolean> {
    return true;
  }
}

/** Supplies one host-collected answer, then falls back to safe pause behavior. */
export class SubmittedAnswerInteraction implements RubberduckInteraction {
  private used = false;

  constructor(private readonly submittedAnswer: string) {
  }

  async answer(
    question: RubberduckQuestion,
    remainingBlocking: number,
  ): Promise<RubberduckAnswer> {
    if (!this.used) {
      this.used = true;
      return { kind: 'answer', answer: this.submittedAnswer };
    }
    return new PauseInteraction().answer(question, remainingBlocking);
  }

  async confirmLock(): Promise<boolean> {
    return this.used;
  }
}

/** Safe non-interactive default: persist discovery and wait for a human. */
export class PauseInteraction implements RubberduckInteraction {
  async answer(question: RubberduckQuestion, remainingBlocking: number): Promise<RubberduckAnswer> {
    // In agent-hosted/non-TTY runs there is no readline prompt. Emit a
    // human-readable handoff so hosts such as OpenCode can surface it.
    console.error(`\nRubberduck requires input (${remainingBlocking} blocking decision(s) remain).`);
    console.error(`${question.id} [${question.type}] ${question.text}`);
    console.error('Resume in a terminal, or rerun with --accept-defaults to delegate.');
    return { kind: 'pause' };
  }

  async confirmLock(): Promise<boolean> {
    return false;
  }
}

export function createRubberduckInteraction(
  acceptDefaults = false,
  submittedAnswer?: string,
): RubberduckInteraction {
  if (acceptDefaults) return new AcceptDefaultsInteraction();
  if (submittedAnswer?.trim()) return new SubmittedAnswerInteraction(submittedAnswer.trim());
  if (stdin.isTTY && stdout.isTTY) return new TerminalRubberduckInteraction();
  return new PauseInteraction();
}
