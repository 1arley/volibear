import { randomUUID } from 'node:crypto';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';
import { createRubberduckInteraction } from '../rubberduck-interaction.js';
import { reportRunResult } from './report.js';

/**
 * volibear build <task> — start a development pipeline.
 */
export async function runBuild(positional: string[], options: CliOptions): Promise<number> {
  const task = positional.join(' ');
  if (!task) {
    console.error('Usage: volibear build <task>');
    return 1;
  }

  let app: Awaited<ReturnType<typeof App.create>>;
  try {
    app = await App.create(process.cwd(), options);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (app.configSource === 'defaults') {
    console.log('[volibear] no .volibear/config.yaml found — using defaults (mock executor, no verification).');
    console.log('[volibear] run `volibear install` to configure this project.');
    console.log('');
  }

  try {
    app.validateExecutors();
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const runId = 'run-' + randomUUID().slice(0, 12);
  const run = app.runStore.create(runId, app.config.pipeline, task);

  try {
    const pipeline = await app.getPipeline(options.pipeline);
    if (app.config.verification.commands.length === 0) {
      console.log('[volibear] warning: no verification commands configured — the run can PASS without project checks.');
    }
    const orchestrator = app.createOrchestrator(runId, {
      rubberduckInteraction: createRubberduckInteraction(options.acceptDefaults),
      onStage: (stageId, current) => {
        console.log(`  stage: ${stageId} [${current.state}]`);
      },
    });

    console.log(`Volibear run ${runId}`);
    console.log(`Task: ${task}`);
    console.log(`Pipeline: ${pipeline.name}`);
    console.log('');

    const result = await orchestrator.run(pipeline, run);
    return reportRunResult(app.runStore, runId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.runStore.update(runId, { state: 'FAIL', error: message });
    console.error(`\n✗ Pipeline failed: ${message}`);
    return 1;
  }
}
