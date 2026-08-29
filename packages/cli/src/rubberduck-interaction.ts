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

/** Safe non-interactive default: persist discovery and wait for a human. */
export class PauseInteraction implements RubberduckInteraction {
  async answer(): Promise<RubberduckAnswer> {
    return { kind: 'pause' };
  }

  async confirmLock(): Promise<boolean> {
    return false;
  }
}

export function createRubberduckInteraction(
  acceptDefaults = false,
): RubberduckInteraction {
  if (acceptDefaults) return new AcceptDefaultsInteraction();
  if (stdin.isTTY && stdout.isTTY) return new TerminalRubberduckInteraction();
  return new PauseInteraction();
}
