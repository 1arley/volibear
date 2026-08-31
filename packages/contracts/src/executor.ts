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
  /** Run a plain shell command */
  runCommand?(ctx: ExecutorContext): Promise<ExecutorResult>;
}
