import { spawn } from 'node:child_process';
import {
  AgentDefinition,
  AgentId,
  Executor,
  ExecutorContext,
  Pipeline,
  RubberduckInteraction,
  Stage,
  ArchitectureSchema,
  ImplementationSchema,
  ReviewSchema,
} from '@volibear/contracts';
import { EventLog, ArtifactStore, RunStore, StageExecutionStore } from '@volibear/core';
import { GateRegistry, GateParams } from './gates.js';
import { runRubberduck, RubberduckDriver } from './rubberduck.js';
import { PermissionGuard } from './permission-guard.js';
import { buildStageHandoff, handoffHash } from './handoffs.js';

export interface RuntimeServices {
  events: EventLog;
  artifacts: ArtifactStore;
  gates: GateRegistry;
  runStore: RunStore;
  executions: StageExecutionStore;
  permissionGuard?: PermissionGuard;
  cwd: string;
  runDir: string;
  nativeSessionId?: string;
  onOutput?: (chunk: string) => void;
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
  /** Accumulated outputs from previous pipeline stages */
  pipelineContext: Record<string, unknown>;
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
        if (stage.gate === 'verification-passed') {
          return { kind: 'fail', error: result.reason };
        }
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

  const attempt = 1;
  const executionId = `${stage.id}-cycle-${ctx.repairCycle}-${stage.agent}-attempt-${attempt}`;
  const handoff = buildStageHandoff({
    runId: ctx.runId,
    pipeline: ctx.pipeline,
    stageId: stage.id,
    role: stage.agent as AgentId,
    cycle: ctx.repairCycle,
    attempt,
    task: ctx.task,
    artifacts: ctx.services.artifacts,
    verificationCommands: ctx.services.config.verification.commands,
  });
  const existingExecution = ctx.services.executions.load(executionId);
  if (existingExecution?.status === 'completed') return { kind: 'continue' };
  if (!existingExecution) ctx.services.executions.create({
    schema_version: 1,
    execution_id: executionId,
    run_id: ctx.runId,
    stage_id: stage.id,
    role: stage.agent as AgentId,
    cycle: ctx.repairCycle,
    attempt,
    handoff_hash: handoffHash(handoff),
    status: 'prepared',
    executor: agent.executor,
  }, handoff);

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
    pipelineContext: ctx.pipelineContext,
    handoff,
    executionId,
    resumeSessionId: agent.executor === 'opencode' && agent.router === 'native'
      ? undefined
      : existingExecution?.session_id,
    nativeSessionId: agent.executor === 'opencode' && agent.router === 'native'
      ? ctx.services.nativeSessionId
      : undefined,
    nativeRequestMessageId: existingExecution?.request_message_id ?? nativeRequestId(ctx.runId, executionId),
    resumeChildSessionId: existingExecution?.child_session_id,
    onMetadata: (metadata) => {
      ctx.services.executions.update(executionId, {
        status: metadata.remoteStatus === 'busy' || metadata.remoteStatus === 'retry'
          ? 'running'
          : 'session_created',
        session_id: metadata.sessionId,
        native_session_id: metadata.nativeSessionId,
        request_message_id: metadata.requestMessageId,
        child_session_id: metadata.childSessionId,
        remote_agent: metadata.remoteAgent,
        server_url: metadata.serverUrl,
        message_id: metadata.messageId,
        last_event_at: metadata.lastEventAt,
        remote_status: metadata.remoteStatus,
        started_at: metadata.startedAt,
      });
      if (metadata.nativeSessionId) events.record('opencode.subagent.updated', ctx.runId, {
        stage: stage.id,
        execution_id: executionId,
        role: stage.agent,
        primary_session_id: metadata.nativeSessionId,
        child_session_id: metadata.childSessionId,
        message_id: metadata.requestMessageId ?? metadata.messageId,
        status: metadata.remoteStatus ?? 'prepared',
      });
    },
    onOutput: ctx.services.onOutput,
  };

  try {
    let result;
    if (ctx.services.permissionGuard && agent.permissions.repository === 'read') {
      const { result: r, violations } = await ctx.services.permissionGuard.enforce(
        agent,
        executor,
        ec,
      );
      result = r;
      if (violations.length > 0) {
        for (const v of violations) {
          events.record('permission.violation', ctx.runId, { stage: stage.id, violation: v });
        }
        return { kind: 'fail', error: `permission violations:\n${violations.join('\n')}` };
      }
    } else {
      result = await executor.runAgent(ec);
    }
    ctx.services.executions.writeRawOutput(executionId, result.stdout);
    if (result.exitCode !== 0) {
      ctx.services.executions.update(executionId, {
        status: result.failure?.code === 'TIMEOUT' ? 'timed_out' : result.failure?.code === 'CANCELLED' ? 'cancelled' : 'failed',
        exit_code: result.exitCode,
        completed_at: new Date().toISOString(),
        error: result.failure?.message ?? result.stderr,
      });
      if (result.failure?.ambiguousSideEffects) {
        return { kind: 'gate-blocked', gate: 'ambiguous-agent-effects', reason: result.failure.message };
      }
      return { kind: 'fail', error: `agent "${stage.agent}" exited with ${result.exitCode}: ${result.failure?.message ?? result.stderr}` };
    }
    const fallback = agent.executor === 'opencode'
      ? undefined
      : existingRoleArtifact(stage.agent as AgentId, ctx.services.artifacts);
    const validated = validateAgentOutput(stage.agent as AgentId, result.structured ?? fallback);
    if (validated) ctx.services.executions.writeStructuredOutput(executionId, validated);
    if (result.structured || agent.executor === 'opencode') {
      persistAgentArtifact(stage.agent as AgentId, validated, ctx.services.artifacts);
    }
    ctx.services.executions.update(executionId, {
      status: 'completed', exit_code: 0, completed_at: new Date().toISOString(),
    });
    events.record('stage.completed', ctx.runId, {
      stage: stage.id,
      agent: stage.agent,
      exitCode: 0,
    });
    return { kind: 'continue' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.record('stage.failed', ctx.runId, { stage: stage.id, error: message });
    ctx.services.executions.update(executionId, {
      status: 'failed', completed_at: new Date().toISOString(), error: message,
    });
    return { kind: 'fail', error: message };
  }
}

function nativeRequestId(runId: string, executionId: string): string {
  return `msg_volibear_${handoffHash({ runId, executionId } as never).slice(0, 20)}`;
}

function validateAgentOutput(role: AgentId, structured: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!structured || Object.keys(structured).length === 1 && typeof structured.output === 'string') {
    throw new Error(`agent "${role}" did not return the required structured output`);
  }
  if (role === 'architect') return ArchitectureSchema.parse(structured);
  if (role === 'developer' || role === 'fixer') return ImplementationSchema.parse(structured);
  if (role === 'reviewer') return ReviewSchema.parse(structured);
  return structured;
}

function existingRoleArtifact(role: AgentId, artifacts: ArtifactStore): Record<string, unknown> | undefined {
  const kind = role === 'architect' ? 'architecture'
    : role === 'developer' || role === 'fixer' ? 'implementation'
      : role === 'reviewer' ? 'review'
        : undefined;
  if (!kind) return undefined;
  const value = artifacts.read(kind);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function persistAgentArtifact(role: AgentId, structured: Record<string, unknown> | undefined, artifacts: ArtifactStore): void {
  if (!structured) return;
  if (role === 'architect') artifacts.write('architecture', structured);
  if (role === 'developer' || role === 'fixer') artifacts.write('implementation', structured);
  if (role === 'reviewer') artifacts.write('review', structured);
  if (role === 'verifier') artifacts.writeRaw('verifier-report.json', JSON.stringify(structured, null, 2));
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

  // The following verifier agent must always receive the deterministic result,
  // including failures. A later deterministic gate remains the PASS authority.
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
  // Existence/content map so gates can inspect artifacts declaratively.
  const artifactNames: Array<'requirements' | 'architecture' | 'implementation' | 'review' | 'verification' | 'findings'> = [
    'requirements', 'architecture', 'implementation', 'review', 'verification', 'findings',
  ];
  const extra: Record<string, unknown> = {};
  for (const name of artifactNames) {
    const exists = ctx.services.artifacts.exists(name);
    extra[name] = exists;
    // For implementation, pass the content so the gate can check real files.
    if (name === 'implementation' && exists) {
      const impl = ctx.services.artifacts.read<Record<string, unknown>>('implementation');
      if (impl) extra[name] = impl;
    }
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
