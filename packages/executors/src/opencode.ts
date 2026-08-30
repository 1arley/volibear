import { CliExecutor } from './base.js';
import { ExecutorContext } from '@volibear/contracts';

/**
 * OpenCode executor adapter.
 *
 * Declares capabilities (headless, interactive, filesystem, tools) and maps
 * the agent invocation to `opencode run --model <provider/model>`. The
 * router provider (e.g. 9Router) is registered in the OpenCode config
 * (opencode.json), not via an environment variable.
 */
export class OpenCodeExecutor extends CliExecutor {
  readonly id = 'opencode';
  readonly capabilities = {
    headless: true,
    interactive: true,
    filesystem: true,
    tools: true,
    custom_endpoint: true,
    structured_output: false,
  };
  protected binary = 'opencode';

  constructor(timeoutMs = 600_000) {
    super(timeoutMs);
  }

  protected env(ctx: ExecutorContext): Record<string, string | undefined> {
    return {
      VOLIBEAR_AGENT: ctx.agent,
      VOLIBEAR_TASK: ctx.task,
    };
  }

  protected buildArgs(ctx: ExecutorContext): string[] {
    const args = ['run'];
    if (ctx.model) args.push('--model', ctx.model);
    return args;
  }
}
