import { Executor } from '@volibear/contracts';
import { MockExecutor } from './mock.js';

/**
 * Executor registry — resolves executor ids to implementations.
 * Real executors (opencode, codex, claude) will register here.
 */
export class ExecutorRegistry {
  private executors = new Map<string, Executor>();

  constructor() {
    this.register(new MockExecutor());
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
