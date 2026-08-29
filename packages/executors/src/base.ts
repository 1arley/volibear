import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  if (ctx.findingsFile) {
    lines.push('', `External findings: ${ctx.findingsFile}`);
  }
  if (ctx.context) {
    lines.push('', 'Repository context:', ctx.context);
  }
  lines.push('', 'Follow the Volibear agent instructions for output format.');
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

  async detect(): Promise<boolean> {
    return commandExists(this.binary);
  }

  protected abstract buildArgs(ctx: ExecutorContext): string[];

  async runAgent(ctx: ExecutorContext): Promise<ExecutorResult> {
    const args = this.buildArgs(ctx);
    const prompt = buildAgentPrompt(ctx);
    const res = spawnSync(this.binary, [...args, prompt], {
      cwd: ctx.cwd,
      env: { ...process.env, ...this.env(ctx) },
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      exitCode: res.status ?? 1,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      structured: this.parseStructuredOutput(res.stdout ?? ''),
    };
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

/** Ensure the run directory exists. */
export function ensureRunDir(runDir: string): void {
  const { mkdirSync } = require('node:fs');
  mkdirSync(runDir, { recursive: true });
  void existsSync(runDir);
}

/** Write a JSON artifact into the run directory. */
export function writeArtifact(runDir: string, name: string, data: unknown): void {
  const { writeFileSync } = require('node:fs');
  writeFileSync(join(runDir, name), JSON.stringify(data, null, 2), 'utf-8');
}
