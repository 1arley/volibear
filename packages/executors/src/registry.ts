import { Executor } from '@volibear/contracts';
import { MockExecutor } from './mock.js';
import { OpenCodeExecutor } from './opencode.js';
import { CodexExecutor } from './codex.js';
import { ClaudeExecutor } from './claude.js';

/**
 * Executor registry — resolves executor ids to implementations.
 * Real executors (opencode, codex, claude) are registered alongside the mock.
 */
export class ExecutorRegistry {
  private executors = new Map<string, Executor>();

  constructor(timeoutMs = 600_000) {
    this.register(new MockExecutor());
    this.register(new OpenCodeExecutor(timeoutMs));
    this.register(new CodexExecutor(timeoutMs));
    this.register(new ClaudeExecutor(timeoutMs));
  }

  register(executor: Executor): void {
    this.executors.set(executor.id, executor);
  }

  get(id: string): Executor | undefined {
    return this.executors.get(id);
  }

  has(id: string): boolean {
    return this.executors.has(id);
  }

  list(): Executor[] {
    return [...this.executors.values()];
  }
}
