import { createHash } from 'node:crypto';
import { AgentId, Pipeline, StageHandoff } from '@volibear/contracts';
import { ArtifactStore } from '@volibear/core';

function read(store: ArtifactStore, kind: Parameters<ArtifactStore['read']>[0]): unknown {
  return store.read(kind);
}

/** Construct the minimum persisted snapshot required by one role. */
export function buildStageHandoff(input: {
  runId: string;
  pipeline: Pipeline;
  stageId: string;
  role: AgentId;
  cycle: number;
  attempt: number;
  task: string;
  artifacts: ArtifactStore;
  verificationCommands: string[];
}): StageHandoff<Record<string, unknown>> {
  const { role, artifacts } = input;
  let inputs: Record<string, unknown>;
  switch (role) {
    case 'rubberduck':
      inputs = { findings: read(artifacts, 'findings'), discovery: read(artifacts, 'discovery') };
      break;
    case 'architect':
      inputs = { requirements: read(artifacts, 'requirements'), requirements_locked: artifacts.readRaw('requirements.lock') !== null };
      break;
    case 'developer':
      inputs = { requirements: read(artifacts, 'requirements'), architecture: read(artifacts, 'architecture') };
      break;
    case 'reviewer':
      inputs = { architecture: read(artifacts, 'architecture'), implementation: read(artifacts, 'implementation') };
      break;
    case 'fixer':
      inputs = { architecture: read(artifacts, 'architecture'), implementation: read(artifacts, 'implementation'), review: read(artifacts, 'review') };
      break;
    case 'verifier':
      inputs = { verification: read(artifacts, 'verification'), commands: input.verificationCommands };
      break;
  }
  return {
    schema_version: 1,
    run_id: input.runId,
    pipeline: { name: input.pipeline.name, version: input.pipeline.version },
    stage: { id: input.stageId, role, cycle: input.cycle, attempt: input.attempt },
    task: input.task,
    inputs,
    expected_output: { kind: roleOutputKind(role), schema_version: 1 },
    constraints: [
      'Use only this handoff and repository evidence needed for this stage.',
      'Do not invoke another agent or reconstruct the Volibear pipeline.',
      'Return the requested structured JSON object as the final response.',
    ],
  };
}

export function handoffHash(handoff: StageHandoff): string {
  return createHash('sha256').update(JSON.stringify(handoff)).digest('hex');
}

export function roleOutputKind(role: AgentId): string {
  return ({
    rubberduck: 'requirements', architect: 'architecture', developer: 'implementation',
    reviewer: 'review', fixer: 'implementation', verifier: 'verification-report',
  } as const)[role];
}
