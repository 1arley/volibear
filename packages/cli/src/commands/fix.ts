import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ExternalFindingsFile, ExternalFindingsFileSchema } from '@volibear/contracts';
import { ArtifactStore } from '@volibear/core';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';
import { createRubberduckInteraction } from '../rubberduck-interaction.js';
import { terminalSymbol } from './build.js';

/**
 * volibear fix [findings.json] — fix external findings through a pipeline.
 * Uses the `fix` pipeline and optionally imports a findings file (e.g. from ORNN).
 */
export async function runFix(positional: string[], options: CliOptions): Promise<number> {
  const app = await App.create(process.cwd(), options);
  const findingsFile = positional[0];

  // Validate and load findings if provided.
  let findings: ExternalFindingsFile | undefined;
  let findingsSummary = '';
  if (findingsFile) {
    const path = resolve(process.cwd(), findingsFile);
    if (!existsSync(path)) {
      console.error(`Findings file not found: ${findingsFile}`);
      return 1;
    }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      findings = ExternalFindingsFileSchema.parse(raw);
      findingsSummary = ` (${findings.findings.length} findings imported)`;
      console.log(`Imported ${findings.findings.length} findings from ${findingsFile}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Invalid findings file: ${message}`);
      return 1;
    }
  }

  const runId = 'run-' + randomUUID().slice(0, 12);
  const run = app.runStore.create(
    runId,
    'fix',
    `Fix external findings${findingsSummary}`,
    findingsFile,
  );
  if (findings) {
    new ArtifactStore(app.runStore.runDir(runId)).write('findings', findings);
  }

  try {
    const pipeline = await app.getPipeline('fix');
    const orchestrator = app.createOrchestrator(runId, {
      findings,
      rubberduckInteraction: createRubberduckInteraction(options.acceptDefaults),
      onStage: (stageId, current) => {
        console.log(`  stage: ${stageId} [${current.state}]`);
      },
    });

    console.log(`Volibear fix run ${runId}`);
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
