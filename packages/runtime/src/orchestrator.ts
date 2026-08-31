import {
  AgentDefinition,
  Executor,
  Pipeline,
  RubberduckInteraction,
  Run,
  RunState,
} from '@volibear/contracts';
import { EventLog, ArtifactStore, RunStore, StageExecutionStore } from '@volibear/core';
import { GateRegistry } from './gates.js';
import { runStage, RuntimeServices } from './stage-runner.js';
import { PermissionGuard } from './permission-guard.js';

export interface OrchestratorOptions {
  runStore: RunStore;
  events: EventLog;
  artifacts: ArtifactStore;
  gates?: GateRegistry;
  cwd: string;
  agents: Map<string, AgentDefinition>;
  executors: Map<string, Executor>;
  config: {
    repair: { max_cycles: number; reject_on: string[] };
    verification: { commands: string[] };
  };
  /** Reasoning driver that discovers questions and produces requirements. */
  rubberduck?: import('@volibear/contracts').RubberduckDriver;
  /** Optional human interaction; omit only for explicit headless execution. */
  rubberduckInteraction?: RubberduckInteraction;
  /** Structured external findings provided to findings. */
  findings?: unknown;
  /** Enforces agent permission constraints (filesystem sandboxing). */
  permissionGuard?: PermissionGuard;
  /** Called after each stage for progress reporting */
  onStage?: (stageId: string, run: Run) => void;
  /** Receives live executor output chunks. */
  onOutput?: (chunk: string) => void;
}

/**
 * Maps a stage's semantic phase to a run state, used for status display.
 */
export function stagePhase(stageId: string): RunState {
  if (stageId === 'rubberduck' || stageId === 'discovery') return 'DISCOVERY';
  if (stageId === 'architect' || stageId === 'architecture') return 'ARCHITECTURE';
  if (stageId === 'developer' || stageId === 'implementation') return 'IMPLEMENTATION';
  if (stageId === 'reviewer' || stageId === 'review') return 'REVIEW';
  if (stageId === 'fixer' || stageId === 'fixing') return 'FIXING';
  if (stageId === 'verifier' || stageId === 'verification') return 'VERIFICATION';
  return 'DISCOVERY';
}

/**
 * Orchestrates a single pipeline run from CREATED to a terminal state.
 */
export class RunOrchestrator {
  private services: RuntimeServices;
  private gates: GateRegistry;

  constructor(private opts: OrchestratorOptions) {
    this.gates = opts.gates ?? new GateRegistry();
    this.services = {
      events: opts.events,
      artifacts: opts.artifacts,
      gates: this.gates,
      runStore: opts.runStore,
      executions: new StageExecutionStore(opts.artifacts.dir),
      permissionGuard: opts.permissionGuard,
      cwd: opts.cwd,
      runDir: opts.artifacts.dir,
      onOutput: opts.onOutput,
      config: opts.config,
    };
  }

  /**
   * Run a pipeline against an existing run. Returns the final run state.
   */
  async run(pipeline: Pipeline, run: Run): Promise<RunState> {
    const { events, runStore } = this.opts;
    // Lifecycle event only once per run — resume must not re-record it.
    if (run.state === 'CREATED') {
      events.record('run.started', run.id, { pipeline: pipeline.name, task: run.task });
    }

    const ctx = {
      runId: run.id,
      services: this.services,
      pipeline,
      task: run.task,
      agents: this.opts.agents,
      executors: this.opts.executors,
      repairCycle: run.repair_cycle ?? 0,
      rubberduck: this.opts.rubberduck,
      rubberduckInteraction: this.opts.rubberduckInteraction,
      findings: this.opts.findings,
      findingsFile: run.findings_file
        ? this.services.artifacts.exists('findings')
          ? `${this.services.artifacts.dir}/findings.json`
          : run.findings_file
        : undefined,
      getRequirements: () => this.services.artifacts.read('requirements'),
      getReview: () => this.services.artifacts.read('review'),
      getVerification: () => this.services.artifacts.read('verification'),
      pipelineContext: {} as Record<string, unknown>,
    };

    for (const stage of pipeline.stages) {
      // Resume skips stages already persisted as complete.
      if (run.completed_stages.includes(stage.id)) continue;

      // Core safety invariant: Architect never runs without a locked spec.
      if (stage.type === 'agent' && stage.agent === 'architect') {
        const requirements = this.services.artifacts.read('requirements');
        const lock = this.services.artifacts.readRaw('requirements.lock');
        if (!requirements || !lock) {
          const reason = 'Architect requires locked requirements';
          events.record('run.blocked', run.id, { stage: stage.id, reason });
          runStore.update(run.id, { state: 'BLOCKED', current_stage: stage.id, error: reason });
          return 'BLOCKED';
        }
      }

      run = runStore.update(run.id, {
        state: stage.type === 'rubberduck' ? 'DISCOVERY' : stagePhase(stage.id),
        current_stage: stage.id,
        error: undefined,
      }) ?? run;
      this.opts.onStage?.(stage.id, run);

      const outcome = await runStage(stage, ctx);
      run = runStore.update(run.id, { current_stage: stage.id }) ?? run;

      switch (outcome.kind) {
        case 'continue':
          run = runStore.update(run.id, {
            completed_stages: [...new Set([...run.completed_stages, stage.id])],
            repair_cycle: ctx.repairCycle,
          }) ?? run;
          // Accumulate this stage's output artifacts into pipelineContext
          accumulateArtifacts(ctx);
          break;

        case 'waiting-for-user': {
          runStore.update(run.id, {
            state: 'WAITING_FOR_USER',
            current_stage: stage.id,
            error: outcome.reason,
            repair_cycle: ctx.repairCycle,
          });
          return 'WAITING_FOR_USER';
        }

        case 'gate-blocked':
        case 'loop-exhausted': {
          // A gate failure before architecture means we're blocked on user input.
          const terminal: RunState = 'BLOCKED';
          events.record('run.blocked', run.id, {
            stage: stage.id,
            reason: outcome.reason,
          });
          run = runStore.update(run.id, {
            state: terminal,
            error: outcome.reason,
            repair_cycle: ctx.repairCycle,
          }) ?? run;
          return terminal;
        }

        case 'fail': {
          events.record('run.failed', run.id, { stage: stage.id, error: outcome.error });
          run = runStore.update(run.id, {
            state: 'FAIL',
            error: outcome.error,
          }) ?? run;
          return 'FAIL';
        }
      }
    }

    // All stages completed.
    events.record('run.completed', run.id, { status: 'pass' });
    run = runStore.update(run.id, { state: 'PASS', current_stage: undefined }) ?? run;
    return 'PASS';
  }
}

/** Accumulate artifacts produced by the latest stage into pipelineContext. */
function accumulateArtifacts(ctx: import('./stage-runner.js').StageRunContext): void {
  const kinds = ['discovery', 'requirements', 'architecture', 'review', 'verification', 'findings'] as const;
  for (const kind of kinds) {
    if (ctx.services.artifacts.exists(kind)) {
      ctx.pipelineContext[kind] = ctx.services.artifacts.read(kind);
    }
  }
}
