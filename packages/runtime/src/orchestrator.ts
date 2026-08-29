import {
  Pipeline,
  AgentDefinition,
  Executor,
  Run,
  RunState,
} from '@volibear/contracts';
import { EventLog, ArtifactStore, RunStore } from '@volibear/core';
import { GateRegistry } from './gates.js';
import { runStage, RuntimeServices, StageOutcome } from './stage-runner.js';

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
  /** Injected Rubberduck driver; defaults to an immediate-lock driver */
  rubberduck?: import('@volibear/contracts').RubberduckDriver;
  /** Called after each stage for progress reporting */
  onStage?: (stageId: string, run: Run) => void;
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
      cwd: opts.cwd,
      runDir: opts.artifacts.dir,
      config: opts.config,
    };
  }

  /**
   * Run a pipeline against an existing run. Returns the final run state.
   */
  async run(pipeline: Pipeline, run: Run): Promise<RunState> {
    const { events, runStore } = this.opts;
    events.record('run.started', run.id, { pipeline: pipeline.name, task: run.task });

    const ctx = {
      runId: run.id,
      services: this.services,
      pipeline,
      task: run.task,
      agents: this.opts.agents,
      executors: this.opts.executors,
      repairCycle: run.repair_cycle ?? 0,
      rubberduck: this.opts.rubberduck,
      getRequirements: () => this.services.artifacts.read('requirements'),
      getReview: () => this.services.artifacts.read('review'),
      getVerification: () => this.services.artifacts.read('verification'),
    };

    for (const stage of pipeline.stages) {
      run = runStore.update(run.id, {
        state: stage.type === 'rubberduck' ? 'DISCOVERY' : stagePhase(stage.id),
        current_stage: stage.id,
      }) ?? run;
      this.opts.onStage?.(stage.id, run);

      const outcome = await runStage(stage, ctx);
      run = runStore.update(run.id, { current_stage: stage.id }) ?? run;

      switch (outcome.kind) {
        case 'continue':
          run = runStore.update(run.id, {
            completed_stages: [...run.completed_stages, stage.id],
            repair_cycle: ctx.repairCycle,
          }) ?? run;
          break;

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
