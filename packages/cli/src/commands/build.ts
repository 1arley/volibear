import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';
import { createRubberduckInteraction } from '../rubberduck-interaction.js';

/** Map a terminal run state to a status symbol. */
export function terminalSymbol(result: string): string {
  return {
    PASS: '✓',
    FAIL: '✗',
    BLOCKED: '◉',
    WAITING_FOR_USER: '◉',
  }[result] ?? '?';
}

/**
 * volibear build <task> — start a development pipeline.
 */
export async function runBuild(positional: string[], options: CliOptions): Promise<number> {
  const task = positional.join(' ');
  if (!task) {
    console.error('Usage: volibear build <task>');
    return 1;
  }

  const app = await App.create(process.cwd(), options);
  const runId = 'run-' + randomUUID().slice(0, 12);
  const run = app.runStore.create(runId, app.config.pipeline, task);

  try {
    const pipeline = await app.getPipeline(options.pipeline);
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

    const statusSymbol = terminalSymbol(result);
    console.log(`\n${statusSymbol} ${result}`);
    return result === 'PASS' ? 0 : ['BLOCKED', 'WAITING_FOR_USER'].includes(result) ? 2 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.runStore.update(runId, { state: 'FAIL', error: message });
    console.error(`\n✗ Pipeline failed: ${message}`);
    return 1;
  }
}
