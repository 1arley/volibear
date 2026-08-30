import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  ExternalFindingsFile,
  ExternalFindingsFileSchema,
} from '@volibear/contracts';
import { ArtifactStore, formatZodIssues } from '@volibear/core';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';
import { createRubberduckInteraction } from '../rubberduck-interaction.js';
import { reportRunResult } from './report.js';

/**
 * volibear fix [findings.json] — fix external findings through a pipeline.
 * Uses the `fix` pipeline and optionally imports a findings file (e.g. from ORNN).
 */
export async function runFix(positional: string[], options: CliOptions): Promise<number> {
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
      if (err instanceof SyntaxError) {
        console.error(`Invalid findings file ${findingsFile}: not valid JSON — ${err.message}`);
      } else {
        console.error(`Invalid findings file ${findingsFile}: ${formatZodIssues(err)}`);
      }
      return 1;
    }
  } else {
    console.log('[volibear] warning: no findings file provided — the pipeline will run without external findings.');
  }

  const runId = 'run-' + randomUUID().slice(0, 12);
  const pipelineName = options.pipeline ?? 'fix';
  const run = app.runStore.create(
    runId,
    pipelineName,
    `Fix external findings${findingsSummary}`,
    findingsFile,
  );
  if (findings) {
    new ArtifactStore(app.runStore.runDir(runId)).write('findings', findings);
  }

  try {
    const pipeline = await app.getPipeline(pipelineName);
    if (app.config.verification.commands.length === 0) {
      console.log('[volibear] warning: no verification commands configured — the run can PASS without project checks.');
    }
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
    return reportRunResult(app.runStore, runId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.runStore.update(runId, { state: 'FAIL', error: message });
    console.error(`\n✗ Pipeline failed: ${message}`);
    return 1;
  }
}
