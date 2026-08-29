import { createInterface, Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  Requirements,
  RubberduckAnswer,
  RubberduckInteraction,
  RubberduckQuestion,
} from '@volibear/contracts';

/** Terminal implementation of the human side of Rubberduck discovery. */
export class TerminalRubberduckInteraction implements RubberduckInteraction {
  private readonly readline: Interface;

  constructor() {
    this.readline = createInterface({ input: stdin, output: stdout });
  }

  async answer(
    question: RubberduckQuestion,
    remainingBlocking: number,
  ): Promise<RubberduckAnswer> {
    console.log('\nRubberduck');
    console.log(`${remainingBlocking} blocking decision(s) remain.`);
    console.log(`\n${question.id} [${question.type}] ${question.text}`);
    const input = (await this.readline.question(
      'Answer (/delegate to decide for me, /pause to resume later): ',
    )).trim();
    if (input === '/delegate') return { kind: 'delegate' };
    if (input === '/pause') return { kind: 'pause' };
    if (!input) return this.answer(question, remainingBlocking);
    return { kind: 'answer', answer: input };
  }

  async confirmLock(requirements: Requirements): Promise<boolean> {
    console.log('\nRequirements review');
    console.log(`Task: ${requirements.task}`);
    for (const decision of requirements.decisions) {
      console.log(`  ${decision.id}: ${decision.answer}`);
    }
    const input = (await this.readline.question('Lock these requirements? [y/N]: '))
      .trim()
      .toLowerCase();
    return input === 'y' || input === 'yes';
  }

  close(): void {
    this.readline.close();
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
