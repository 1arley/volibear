import { spawn } from 'node:child_process';
import {
  Executor,
  ExecutorContext,
  Pipeline,
  Stage,
  AgentDefinition,
} from '@volibear/contracts';
import { EventLog, ArtifactStore } from '@volibear/core';
import { GateRegistry, GateParams } from './gates.js';
import { runRubberduck, RubberduckDriver } from './rubberduck.js';

export interface RuntimeServices {
  events: EventLog;
  artifacts: ArtifactStore;
  gates: GateRegistry;
  cwd: string;
  runDir: string;
  config: {
    repair: { max_cycles: number; reject_on: string[] };
    verification: { commands: string[] };
  };
}

export interface StageRunContext {
  runId: string;
  services: RuntimeServices;
  pipeline: Pipeline;
  task: string;
  agents: Map<string, AgentDefinition>;
  executors: Map<string, Executor>;
  getRequirements: () => unknown;
  getReview: () => unknown;
  getVerification: () => unknown;
  repairCycle: number;
  rubberduck?: RubberduckDriver;
}

export type StageOutcome =
  | { kind: 'continue' }
  | { kind: 'gate-blocked'; gate: string; reason: string }
  | { kind: 'loop-exhausted'; reason: string }
  | { kind: 'fail'; error: string };

/**
 * Run a single stage of a pipeline.
 */
export async function runStage(
  stage: Stage,
  ctx: StageRunContext,
): Promise<StageOutcome> {
  const { events, artifacts } = ctx.services;

  switch (stage.type) {
    case 'agent': {
      return runAgentStage(stage, ctx);
    }

    case 'gate': {
      const gate = ctx.services.gates.get(stage.gate);
      if (!gate) {
        events.record('gate.failed', ctx.runId, { gate: stage.gate, reason: 'unknown gate' });
        return { kind: 'fail', error: `unknown gate "${stage.gate}"` };
      }
      const params = buildGateParams(stage.gate, ctx);
      const result = gate.evaluate(params);
      events.record(
        result.passed ? 'gate.passed' : 'gate.failed',
        ctx.runId,
        { gate: stage.gate, reason: result.reason },
      );
      if (!result.passed) {
        return { kind: 'gate-blocked', gate: stage.gate, reason: result.reason };
      }
      return { kind: 'continue' };
    }

    case 'command': {
      events.record('stage.started', ctx.runId, { stage: stage.id, type: 'command' });
      const result = await runCommandStage(stage.command!, ctx);
      events.record('stage.completed', ctx.runId, { stage: stage.id, exitCode: result.exitCode });
      if (result.exitCode !== 0) {
        return { kind: 'fail', error: `command "${stage.command}" exited with ${result.exitCode}` };
      }
      return { kind: 'continue' };
    }

    case 'rubberduck': {
      return runRubberduckStage(ctx);
    }

    case 'verify': {
      return runVerifyStage(ctx);
    }

    case 'loop': {
      return runLoopStage(stage, ctx);
    }

    default: {
      const exhaustive: never = stage;
      return { kind: 'fail', error: `unsupported stage type: ${JSON.stringify(exhaustive)}` };
    }
  }
}

// ── Agent stage ────────────────────────────────────────

async function runAgentStage(
  stage: Extract<Stage, { type: 'agent' }>,
  ctx: StageRunContext,
): Promise<StageOutcome> {
  const { events } = ctx.services;
  const agent = ctx.agents.get(stage.agent);
  if (!agent) {
    return { kind: 'fail', error: `unknown agent "${stage.agent}"` };
  }

  const executor = ctx.executors.get(agent.executor);
  if (!executor) {
    return { kind: 'fail', error: `unknown executor "${agent.executor}"` };
  }

  events.record('stage.started', ctx.runId, {
    stage: stage.id,
    type: 'agent',
    agent: stage.agent,
    executor: agent.executor,
  });

  const ec: ExecutorContext = {
    cwd: ctx.services.cwd,
    runDir: ctx.services.runDir,
    task: ctx.task,
    agent: stage.agent,
    model: agent.model,
    router: agent.router,
    permissions: stage.permissions ?? agent.permissions,
  };

  try {
    const result = await executor.runAgent(ec);
    events.record('stage.completed', ctx.runId, {
      stage: stage.id,
      agent: stage.agent,
      exitCode: result.exitCode,
    });
    if (result.exitCode !== 0) {
      return { kind: 'fail', error: `agent "${stage.agent}" exited with ${result.exitCode}` };
    }
    return { kind: 'continue' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.record('stage.failed', ctx.runId, { stage: stage.id, error: message });
    return { kind: 'fail', error: message };
  }
}

// ── Command stage ──────────────────────────────────────

function runCommandStage(
  command: string,
  ctx: StageRunContext,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: ctx.services.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

// ── Verify stage ───────────────────────────────────────

async function runVerifyStage(ctx: StageRunContext): Promise<StageOutcome> {
  const { events, artifacts, config } = ctx.services;
  const commands = config.verification.commands;
  const results = [];
  let allPassed = true;

  for (const cmd of commands) {
    const started = Date.now();
    const r = await runCommandStage(cmd, ctx);
    const duration = Date.now() - started;
    const passed = r.exitCode === 0;
    allPassed = allPassed && passed;
    results.push({ command: cmd, passed, exit_code: r.exitCode, duration_ms: duration });
    events.record('verification.command.executed', ctx.runId, {
      command: cmd,
      passed,
      exit_code: r.exitCode,
    });
  }

  const verification = {
    commands: results,
    passed: allPassed,
    summary: allPassed ? 'all verification commands passed' : 'verification failed',
  };
  artifacts.write('verification', verification);
  events.record('verification.completed', ctx.runId, { status: allPassed ? 'pass' : 'fail' });

  return allPassed ? { kind: 'continue' } : { kind: 'fail', error: 'verification failed' };
}

// ── Rubberduck stage ───────────────────────────────────

function runRubberduckStage(ctx: StageRunContext): Promise<StageOutcome> {
  const { events, artifacts } = ctx.services;
  return runRubberduck(ctx.runId, {
    events,
    artifacts,
    task: ctx.task,
    driver: ctx.rubberduck,
  });
}

// ── Loop stage (repair loop) ───────────────────────────

async function runLoopStage(
  stage: Extract<Stage, { type: 'loop' }>,
  ctx: StageRunContext,
): Promise<StageOutcome> {
  const { events } = ctx.services;
  const maxCycles = stage.max_cycles;
  const gate = ctx.services.gates.get(stage.gate);
  if (!gate) {
    return { kind: 'fail', error: `loop gate "${stage.gate}" not found` };
  }

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    events.record('repair.started', ctx.runId, { cycle });
    ctx.repairCycle = cycle;

    // Run inner stages; on the first pass the developer agent runs, on
    // subsequent passes the fixer agent replaces the developer.
    let blocked = false;
    for (const inner of stage.stages) {
      if (inner.type === 'agent' && inner.agent === 'developer' && cycle > 1) {
        inner.agent = stage.fixer_agent;
      }
      const outcome = await runStage(inner, ctx);
      if (outcome.kind !== 'continue') {
        blocked = true;
        break;
      }
    }
    events.record('repair.cycle.completed', ctx.runId, { cycle, blocked });

    // Evaluate the loop gate (e.g. no-findings-above-threshold)
    const gateResult = gate.evaluate(buildGateParams(stage.gate, ctx));
    events.record(
      gateResult.passed ? 'gate.passed' : 'gate.failed',
      ctx.runId,
      { gate: stage.gate, reason: gateResult.reason },
    );
    if (gateResult.passed) {
      return { kind: 'continue' };
    }
  }

  return {
    kind: 'loop-exhausted',
    reason: `${stage.id} exceeded ${maxCycles} repair cycles; human intervention required`,
  };
}

// ── Gate params builder ────────────────────────────────

function buildGateParams(gateId: string, ctx: StageRunContext): GateParams {
  const { repair } = ctx.services.config;
  const req = ctx.getRequirements();
  const review = ctx.getReview();
  const verification = ctx.getVerification();
  return {
    requirements: req as never,
    review: review as never,
    verification: verification as never,
    repairCycle: ctx.repairCycle,
    maxRepairCycles: repair.max_cycles,
    rejectOn: repair.reject_on,
  };
}
