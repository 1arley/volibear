import { RunStore } from '@volibear/core';
import { Run, RunState } from '@volibear/contracts';

/** Map a terminal run state to a status symbol. */
export function terminalSymbol(result: string): string {
  return {
    PASS: '✓',
    FAIL: '✗',
    BLOCKED: '◉',
    WAITING_FOR_USER: '◉',
  }[result] ?? '?';
}

/** Map a run state to its exit code per the documented CLI contract. */
export function exitCodeFor(result: RunState): number {
  if (result === 'PASS') return 0;
  if (result === 'BLOCKED' || result === 'WAITING_FOR_USER') return 2;
  return 1;
}

/**
 * Print the terminal result with the run error (when present) so failures are
 * visible in the terminal, not only inside run.json.
 */
export function reportRunResult(
  runStore: RunStore,
  runId: string,
  result: RunState,
): number {
  const run: Run | null = runStore.load(runId);
  console.log(`\n${terminalSymbol(result)} ${result}`);
  if (run?.error) {
    console.error(`Error: ${run.error}`);
  }
  return exitCodeFor(result);
}
