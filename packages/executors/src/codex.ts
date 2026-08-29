import { CliExecutor } from './base.js';
import { ExecutorContext } from '@volibear/contracts';

/**
 * Codex executor adapter.
 *
 * Maps the agent invocation to the Codex CLI non-interactive flag.
 * Router/model configuration is passed through environment variables.
 */
export class CodexExecutor extends CliExecutor {
  readonly id = 'codex';
  readonly capabilities = {
    headless: true,
    interactive: false,
    filesystem: true,
    tools: false,
    custom_endpoint: false,
    structured_output: false,
  };
  protected binary = 'codex';

  protected env(ctx: ExecutorContext): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      VOLIBEAR_AGENT: ctx.agent,
      VOLIBEAR_TASK: ctx.task,
    };
    if (ctx.model) env.CODEX_MODEL = ctx.model;
    return env;
  }

  protected buildArgs(ctx: ExecutorContext): string[] {
    return ['exec'];
  }
}
