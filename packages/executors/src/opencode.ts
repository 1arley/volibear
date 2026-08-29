import { CliExecutor } from './base.js';
import { ExecutorContext } from '@volibear/contracts';

/**
 * OpenCode executor adapter.
 *
 * Declares capabilities (headless, interactive, filesystem, tools) and maps
 * the agent invocation to `opencode run`. The router/model configuration is
 * passed through environment variables so OpenCode can resolve the model.
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

  protected env(ctx: ExecutorContext): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      VOLIBEAR_AGENT: ctx.agent,
      VOLIBEAR_TASK: ctx.task,
    };
    if (ctx.model) env.OPENCODE_MODEL = ctx.model;
    if (ctx.router === '9router') env.OPENCODE_ROUTER = '9router';
    return env;
  }

  protected buildArgs(ctx: ExecutorContext): string[] {
    return ['run'];
  }
}
