import { spawn } from 'node:child_process';
import {
  AgentDefinition,
  Executor,
  ExecutorContext,
  Pipeline,
  RubberduckInteraction,
  Stage,
} from '@volibear/contracts';
import { EventLog, ArtifactStore, RunStore } from '@volibear/core';
import { GateRegistry, GateParams } from './gates.js';
import { runRubberduck, RubberduckDriver } from './rubberduck.js';

export interface RuntimeServices {
  events: EventLog;
  artifacts: ArtifactStore;
  gates: GateRegistry;
  runStore: RunStore;
  cwd: string;
  runDir: string;
  config: {
    repair: { max_cycles: number; reject_on: string[] };
    verification: { commands: string[] };
    executor_timeout_ms?: number;
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
  rubberduckInteraction?: RubberduckInteraction;
  findings?: unknown;
  findingsFile?: string;
}

export type StageOutcome =
  | { kind: 'continue' }
  | { kind: 'waiting-for-user'; reason: string }
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
  const { events } = ctx.services;

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
        const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
        return {
          kind: 'fail',
          error: `command "${stage.command}" ${result.timedOut ? 'timed out' : `exited with ${result.exitCode}`}${detail ? `\n${truncate(detail, 1200)}` : ''}`,
        };
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
    instructions: agent.instructions,
    findingsFile: ctx.findingsFile,
    context: buildFindingsContext(ctx.findings),
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
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const timeoutMs = ctx.services.config.executor_timeout_ms ?? 600_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: ctx.services.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\n[volibear] command killed after ${timeoutMs}ms timeout`;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

// ── Verify stage ───────────────────────────────────────

async function runVerifyStage(ctx: StageRunContext): Promise<StageOutcome> {
  const { events, artifacts, config } = ctx.services;
  const commands = config.verification.commands;
  const results = [];
  let allPassed = true;

  if (commands.length === 0) {
    events.record('verification.completed', ctx.runId, { status: 'pass', warning: 'no verification commands configured' });
  }

  const failedCommands: string[] = [];
  for (const cmd of commands) {
    const started = Date.now();
    const r = await runCommandStage(cmd, ctx);
    const duration = Date.now() - started;
    const passed = r.exitCode === 0;
    allPassed = allPassed && passed;
    if (!passed) failedCommands.push(cmd);
    results.push({
      command: cmd,
      passed,
      exit_code: r.exitCode,
      duration_ms: duration,
      stdout: truncate(r.stdout),
      stderr: truncate(r.stderr),
    });
    events.record('verification.command.executed', ctx.runId, {
      command: cmd,
      passed,
      exit_code: r.exitCode,
      duration_ms: duration,
    });
  }

  const verification = {
    commands: results,
    passed: allPassed,
    summary: allPassed
      ? commands.length === 0
        ? 'no verification commands configured — run passed without project checks'
        : 'all verification commands passed'
      : `verification failed: ${failedCommands.join(', ')}`,
  };
  artifacts.write('verification', verification);
  events.record('verification.completed', ctx.runId, { status: allPassed ? 'pass' : 'fail' });

  if (!allPassed) {
    const first = results.find((r) => !r.passed)!;
    const detail = [first.stdout, first.stderr].filter(Boolean).join('\n').trim();
    return {
      kind: 'fail',
      error: `verification failed: ${failedCommands.join(', ')}${detail ? `\n${truncate(detail, 1200)}` : ''}`,
    };
  }
  return { kind: 'continue' };
}

function truncate(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

// ── Rubberduck stage ───────────────────────────────────

function runRubberduckStage(ctx: StageRunContext): Promise<StageOutcome> {
  const { events, artifacts } = ctx.services;
  return runRubberduck(ctx.runId, {
    events,
    artifacts,
    task: ctx.task,
    driver: ctx.rubberduck,
    interaction: ctx.rubberduckInteraction,
    findings: ctx.findings,
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

  // The repair budget is per RUN, not per invocation: ctx.repairCycle carries
  // the cycles already consumed (restored from run.json on resume), so an
  // interrupted-and-resumed loop can never exceed max_cycles in total.
  const startCycle = ctx.repairCycle + 1;
  if (startCycle > maxCycles) {
    return {
      kind: 'loop-exhausted',
      reason: `${stage.id} already consumed ${ctx.repairCycle} of ${maxCycles} repair cycles; human intervention required`,
    };
  }

  for (let cycle = startCycle; cycle <= maxCycles; cycle++) {
    events.record('repair.started', ctx.runId, { cycle, max_cycles: maxCycles });
    ctx.repairCycle = cycle;

    // Run inner stages; on the first pass the developer agent runs, on
    // subsequent passes the fixer agent replaces the developer. The stage
    // object is cloned so the parsed pipeline is never mutated.
    let blocked = false;
    let waitingOutcome: { kind: 'waiting-for-user'; reason: string } | undefined;
    for (const inner of stage.stages) {
      const stageToRun: Stage =
        inner.type === 'agent' && inner.agent === 'developer' && cycle > 1
          ? { ...inner, agent: stage.fixer_agent }
          : inner;
      const outcome = await runStage(stageToRun, ctx);
      if (outcome.kind === 'waiting-for-user') {
        waitingOutcome = outcome;
        blocked = true;
        break;
      }
      if (outcome.kind !== 'continue') {
        blocked = true;
        break;
      }
    }
    events.record('repair.cycle.completed', ctx.runId, { cycle, blocked });

    // Propagate waiting-for-user immediately — don't evaluate the loop gate.
    if (waitingOutcome) return waitingOutcome;

    // Evaluate the loop gate (e.g. no-findings-above-threshold)
    const gateResult = gate.evaluate(buildGateParams(stage.gate, ctx));
    events.record(
      gateResult.passed ? 'gate.passed' : 'gate.failed',
      ctx.runId,
      { gate: stage.gate, reason: gateResult.reason },
    );
    events.record(
      gateResult.passed ? 'review.approved' : 'review.rejected',
      ctx.runId,
      { cycle, reason: gateResult.reason },
    );
    // Persist the consumed cycle immediately so an interrupted run can never
    // recover a fresh repair budget on resume.
    ctx.services.runStore.update(ctx.runId, { repair_cycle: cycle });
    if (gateResult.passed) {
      return { kind: 'continue' };
    }
  }

  return {
    kind: 'loop-exhausted',
    reason: `${stage.id} exceeded ${maxCycles} repair cycles; human intervention required`,
  };
}

/** Build a findings context string from structured findings. */
function buildFindingsContext(findings: unknown): string | undefined {
  if (!findings) return undefined;
  try {
    const parsed = findings as { findings?: Array<{ id: string; severity: string; title: string; recommendation?: string }> };
    if (!parsed.findings || !Array.isArray(parsed.findings)) return undefined;
    return parsed.findings
      .map((f) => `  [${f.severity}] ${f.id}: ${f.title}${f.recommendation ? ` — ${f.recommendation}` : ''}`)
      .join('\n');
  } catch {
    return undefined;
  }
}

// ── Gate params builder ────────────────────────────────

function buildGateParams(gateId: string, ctx: StageRunContext): GateParams {
  const { repair } = ctx.services.config;
  const req = ctx.getRequirements();
  const review = ctx.getReview();
  const verification = ctx.getVerification();
  // Existence map so the artifacts-exist gate can be used declaratively.
  const artifactNames: Array<'requirements' | 'architecture' | 'implementation' | 'review' | 'verification' | 'findings'> = [
    'requirements', 'architecture', 'implementation', 'review', 'verification', 'findings',
  ];
  const extra: Record<string, unknown> = {};
  for (const name of artifactNames) {
    extra[name] = ctx.services.artifacts.exists(name);
  }
  return {
    requirements: req as never,
    review: review as never,
    verification: verification as never,
    repairCycle: ctx.repairCycle,
    maxRepairCycles: repair.max_cycles,
    rejectOn: repair.reject_on,
    requirementsLocked: ctx.services.artifacts.readRaw('requirements.lock') !== null,
    extra,
  };
}
