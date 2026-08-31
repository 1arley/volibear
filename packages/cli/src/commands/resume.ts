import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExternalFindingsFile, Run } from '@volibear/contracts';
import { ArtifactStore } from '@volibear/core';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';
import { createRubberduckInteraction } from '../rubberduck-interaction.js';
import { reportRunResult } from './report.js';

const TERMINAL = ['PASS', 'FAIL', 'BLOCKED'];

/**
 * volibear resume — resume the latest resumable run.
 * A run is resumable when it is not in a terminal state. With --force, a
 * BLOCKED run may be retried with a fresh repair-cycle budget.
 */
export async function runResume(_positional: string[], options: CliOptions): Promise<number> {
  if (!existsSync(resolve(process.cwd(), '.volibear'))) {
    console.error('No Volibear project installed. Run: volibear install');
    return 1;
  }

  let app: Awaited<ReturnType<typeof App.create>>;
  try {
    app = await App.create(process.cwd(), options);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const runs = app.runStore.list();
  if (runs.length === 0) {
    console.error('No runs to resume. Start one with: volibear build "<task>"');
    return 1;
  }

  let target: Run | undefined = runs.find((r) => !TERMINAL.includes(r.state));
  if (!target) {
    const latest = runs[0];
    if (options.force && latest.state === 'BLOCKED') {
      target = latest;
    } else {
      console.log(`No resumable runs. Latest run ${latest.id} is ${latest.state}.`);
      if (latest.state === 'BLOCKED') {
        console.log('Use `volibear resume --force` to retry a BLOCKED run with a fresh repair budget.');
      }
      return 0;
    }
  }

  if (options.force && target.state === 'BLOCKED') {
    console.log(`Retrying BLOCKED run ${target.id} with a fresh repair-cycle budget.`);
    app.runStore.update(target.id, { repair_cycle: 0, error: undefined });
    target = app.runStore.load(target.id)!;
  }

  console.log(`Resuming run ${target.id} (${target.state})`);

  // Non-interactive resume would silently re-pause only when interactive
  // discovery work remains; beyond that stage the pipeline can proceed.
  const interactiveWorkRemains =
    target.current_stage === 'rubberduck' || target.current_stage === 'discovery';
  if (!options.acceptDefaults && interactiveWorkRemains && !(stdin.isTTY && stdout.isTTY)) {
    console.log('Non-interactive resume detected. Use --accept-defaults to delegate decisions automatically.');
    return 2;
  }

  // Guard: mock executor cannot perform real implementation work.
  if (!options.allowMock) {
    const agents = app.getAgents();
    const executorIds = new Set([...agents.values()].map((a) => a.executor));
    const allMock = executorIds.size === 1 && executorIds.has('mock');
    if (allMock && target.state !== 'WAITING_FOR_USER') {
      console.error('\n✗ All agents use the "mock" executor — no real implementation will be performed.');
      console.error('  Configure a real executor (opencode, codex, claude) in .volibear/config.yaml');
      return 1;
    }
  }

  try {
    app.validateExecutors();
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  try {
    const pipeline = await app.getPipeline(target.pipeline);
    const findings = new ArtifactStore(app.runStore.runDir(target.id))
      .read<ExternalFindingsFile>('findings') ?? undefined;
    const orchestrator = app.createOrchestrator(target.id, {
      findings,
      rubberduckInteraction: createRubberduckInteraction(options.acceptDefaults),
      onStage: (stageId, current) => {
        console.log(`  stage: ${stageId} [${current.state}]`);
      },
    });
    const result = await orchestrator.run(pipeline, target);
    return reportRunResult(app.runStore, target.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.runStore.update(target.id, { state: 'FAIL', error: message });
    console.error(`\n✗ Resume failed: ${message}`);
    return 1;
  } finally {
    await app.close();
  }
}
