import { spawn, spawnSync } from 'node:child_process';
import {
  Executor,
  ExecutorCapabilities,
  ExecutorContext,
  ExecutorResult,
} from '@volibear/contracts';

/** Determine whether a CLI binary is available on PATH. */
export function commandExists(command: string): boolean {
  const first = command.split(/\s+/)[0];
  const res = spawnSync('sh', ['-c', `command -v ${first}`], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return res.status === 0 && (res.stdout ?? '').trim().length > 0;
}

/** Build the base prompt for an agent role from its instruction file. */
export function buildAgentPrompt(ctx: ExecutorContext): string {
  const lines = [
    `You are the ${ctx.agent} agent in the Volibear engineering pipeline.`,
    '',
    `Task: ${ctx.task}`,
  ];
  if (ctx.instructions) {
    lines.push('', '# Agent instructions', '', ctx.instructions);
  }
  if (ctx.findingsFile) {
    lines.push('', `External findings: ${ctx.findingsFile}`);
  }
  if (ctx.context) {
    lines.push('', 'Repository context:', ctx.context);
  }
  if (ctx.pipelineContext && Object.keys(ctx.pipelineContext).length > 0) {
    lines.push('', '# Previous stage outputs');
    for (const [kind, data] of Object.entries(ctx.pipelineContext)) {
      const preview = JSON.stringify(data, null, 2).slice(0, 4000);
      lines.push('', `## ${kind}`, '```json', preview, '```');
    }
  }
  return lines.join('\n');
}

/**
 * Base class for CLI-based executors. Subclasses declare the binary name,
 * argument shape, and how to read structured output.
 */
export abstract class CliExecutor implements Executor {
  abstract readonly id: string;
  abstract readonly capabilities: ExecutorCapabilities;
  /** Binary name used for detection, e.g. "opencode". */
  protected abstract binary: string;
  /** Env vars to set on the child process. */
  protected abstract env(ctx: ExecutorContext): Record<string, string | undefined>;
  /** Hard timeout for an agent invocation (ms). */
  protected readonly timeoutMs: number;

  constructor(timeoutMs = 600_000) {
    this.timeoutMs = timeoutMs;
  }

  async detect(): Promise<boolean> {
    return commandExists(this.binary);
  }

  protected abstract buildArgs(ctx: ExecutorContext): string[];

  async runAgent(ctx: ExecutorContext): Promise<ExecutorResult> {
    const available = await this.detect();
    if (!available) {
      return this.missingBinaryError();
    }

    // Guard against interactive CLIs that would hang a headless invocation.
    if (!this.capabilities.headless) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `executor "${this.id}" does not declare headless support; refusing to run interactively`,
      };
    }

    const args = this.buildArgs(ctx);
    return this.spawnAgent(this.binary, args, ctx, { ...process.env, ...this.env(ctx) });
  }

  /**
   * Spawn the CLI binary and collect stdout/stderr with a hard timeout.
   *
   * Shared by `runAgent` and by subclasses that retry an invocation with a
   * different argument shape (e.g. a legacy-flag fallback). Using async spawn
   * (not spawnSync) keeps the timeout from blocking the event loop.
   */
  protected spawnAgent(
    binary: string,
    args: string[],
    ctx: ExecutorContext,
    env: Record<string, string | undefined>,
  ): Promise<ExecutorResult> {
    const prompt = buildAgentPrompt(ctx);
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      const child = spawn(binary, args, {
        cwd: ctx.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Pipe prompt via stdin instead of passing as CLI argument.
      // This prevents TUI-based CLIs from hanging on argument parsing.
      child.stdin.write(prompt);
      child.stdin.end();
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, this.timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout,
          stderr: `${stderr}\nexecutor "${this.id}" error: ${err.message}`,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          resolve({
            exitCode: 1,
            stdout,
            stderr: `executor "${this.id}" was killed after ${this.timeoutMs / 1000}s timeout`,
          });
        } else {
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            structured: this.parseStructuredOutput(stdout),
          });
        }
      });
    });
  }

  /** Subclasses parse structured JSON the CLI emits (if any). */
  protected parseStructuredOutput(_stdout: string): Record<string, unknown> | undefined {
    return undefined;
  }

  protected missingBinaryError(): ExecutorResult {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${this.binary} not found on PATH. Install it or set --executor mock.`,
    };
  }
}

/** Extract the first JSON object from a stream that may contain prose. */
export function extractJsonFromOutput(output: string): Record<string, unknown> | undefined {
  const start = output.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < output.length; i++) {
    if (output[i] === '{') depth++;
    else if (output[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(output.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}