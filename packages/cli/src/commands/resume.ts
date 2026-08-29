import { CliOptions } from '../cli.js';
import { App } from '../app.js';

/**
 * volibear resume — resume the latest interrupted run.
 * For the MVP: re-runs the pipeline from the current state if the latest run
 * is not in a terminal state.
 */
export async function runResume(_positional: string[], options: CliOptions): Promise<number> {
  const app = await App.create(process.cwd(), options);
  const latest = app.runStore.latest();
  if (!latest) {
    console.error('No runs to resume.');
    return 1;
  }

  const terminal = ['PASS', 'FAIL', 'BLOCKED'];
  if (terminal.includes(latest.state)) {
    console.log(`Latest run ${latest.id} is already ${latest.state}. Nothing to resume.`);
    return 0;
  }

  console.log(`Resuming run ${latest.id} (${latest.state})`);
  try {
    const pipeline = await app.getPipeline(latest.pipeline);
    const orchestrator = app.createOrchestrator(latest.id, (stageId, r) => {
      console.log(`  stage: ${stageId} [${r.state}]`);
    });
    const result = await orchestrator.run(pipeline, latest);
    console.log(`\n${result}`);
    return result === 'PASS' ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Resume failed: ${message}`);
    return 1;
  }
}
