import { CliExecutor } from './base.js';
import { ExecutorContext } from '@volibear/contracts';

/**
 * Claude Code executor adapter.
 *
 * Maps the agent invocation to `claude -p` (print/headless mode).
 * Router/model configuration is passed through environment variables.
 */
export class ClaudeExecutor extends CliExecutor {
  readonly id = 'claude';
  readonly capabilities = {
    headless: true,
    interactive: false,
    filesystem: true,
    tools: true,
    custom_endpoint: true,
    structured_output: false,
  };
  protected binary = 'claude';

  constructor(timeoutMs = 600_000) {
    super(timeoutMs);
  }

  protected env(ctx: ExecutorContext): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      VOLIBEAR_AGENT: ctx.agent,
      VOLIBEAR_TASK: ctx.task,
    };
    if (ctx.model) env.ANTHROPIC_MODEL = ctx.model;
    if (ctx.router === '9router') env.CLAUDE_ROUTER = '9router';
    return env;
  }

  protected buildArgs(_ctx: ExecutorContext): string[] {
    return ['-p'];
  }
}
