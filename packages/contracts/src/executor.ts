import { z } from 'zod';

// ── Executor capabilities ──────────────────────────────

export const ExecutorCapabilitiesSchema = z.object({
  headless: z.boolean().default(true),
  interactive: z.boolean().default(false),
  filesystem: z.boolean().default(true),
  tools: z.boolean().default(false),
  custom_endpoint: z.boolean().default(false),
  structured_output: z.boolean().default(false),
});

export type ExecutorCapabilities = z.infer<typeof ExecutorCapabilitiesSchema>;

// ── Executor invocation ────────────────────────────────

export interface ExecutorContext {
  /** Working directory (project root) */
  cwd: string;
  /** Run directory for artifacts */
  runDir: string;
  /** Task/instructions for the agent */
  task: string;
  /** Agent role id (e.g. 'developer') */
  agent: string;
  /** Configured model name, if any */
  model?: string;
  /** Router mode ('native' | '9router') */
  router?: string;
  /** Permissions granted to this invocation */
  permissions?: {
    repository?: 'read' | 'write';
    shell?: 'denied' | 'read-only' | 'full';
    tests?: boolean;
    network?: boolean;
  };
  /** Repository context passed as evidence (file list, diffs) */
  context?: string;
  /** Agent instruction text (role playbook) to include in the prompt */
  instructions?: string;
  /** Path to external findings, if any */
  findingsFile?: string;
  /** Accumulated outputs from previous pipeline stages */
  pipelineContext?: Record<string, unknown>;
  /** Stage-specific context assembled and persisted by Volibear. */
  handoff?: import('./execution.js').StageHandoff;
  /** Stable persisted execution attempt id. */
  executionId?: string;
  /** Previously persisted session to reconcile after a lost local response. */
  resumeSessionId?: string;
  /** Active OpenCode primary session for native in-session delegation. */
  nativeSessionId?: string;
  /** Stable OpenCode user-message id used to correlate one native subtask. */
  nativeRequestMessageId?: string;
  /** Persisted OpenCode child session for native recovery. */
  resumeChildSessionId?: string;
  /** Cooperative cancellation for SDK-based executors. */
  abortSignal?: AbortSignal;
  /** Persist transport metadata as soon as it becomes available. */
  onMetadata?: (metadata: ExecutorMetadata) => void | Promise<void>;
  /** Callback for streaming output */
  onOutput?: (chunk: string) => void;
}

export interface ExecutorResult {
  /** Exit code; 0 means success */
  exitCode: number;
  /** Raw stdout */
  stdout: string;
  /** Raw stderr */
  stderr: string;
  /** Structured output when the executor supports it */
  structured?: Record<string, unknown>;
  metadata?: ExecutorMetadata;
  failure?: ExecutorFailure;
}

export interface ExecutorMetadata {
  transport: 'cli' | 'opencode-sdk' | 'mock';
  sessionId?: string;
  nativeSessionId?: string;
  requestMessageId?: string;
  childSessionId?: string;
  remoteAgent?: string;
  serverUrl?: string;
  startedAt?: string;
  completedAt?: string;
  recovered?: boolean;
  messageId?: string;
  lastEventAt?: string;
  remoteStatus?: 'busy' | 'idle' | 'retry' | 'error';
}

export interface ExecutorFailure {
  code: 'NOT_AVAILABLE' | 'CONNECTION_FAILED' | 'AGENT_NOT_FOUND' | 'SESSION_LOST' |
    'TIMEOUT' | 'CANCELLED' | 'REMOTE_ERROR' | 'INVALID_OUTPUT';
  message: string;
  retryable: boolean;
  ambiguousSideEffects?: boolean;
}

/**
 * The coding-CLI abstraction. An executor runs an agent (or command)
 * and returns a result. Executors are declared by adapter packages.
 */
export interface Executor {
  readonly id: string;
  readonly capabilities: ExecutorCapabilities;
  /** Detect whether this executor is available on this machine */
  detect(): Promise<boolean>;
  /** Run an agent-style invocation */
  runAgent(ctx: ExecutorContext): Promise<ExecutorResult>;
  /** Create or validate a caller-owned native session for one pipeline run. */
  ensureNativeSession?(ctx: {
    cwd: string;
    runId: string;
    resumeSessionId?: string;
    abortSignal?: AbortSignal;
  }): Promise<ExecutorMetadata>;
  /** Run a plain shell command */
  runCommand?(ctx: ExecutorContext): Promise<ExecutorResult>;
  /** Release executor-owned resources (never external services). */
  close?(): Promise<void>;
}
