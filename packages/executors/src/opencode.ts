import { commandExists } from './base.js';
import { Executor, ExecutorContext, ExecutorResult } from '@volibear/contracts';
import { OpenCodeServerManager, unwrapSdkData } from './opencode-client.js';

interface AgentInfo { name?: string }
interface SessionInfo { id: string; parentID?: string }
interface PromptPart { type?: string; text?: string }
interface PromptInfo { parts?: PromptPart[] }
interface MessageInfo { info?: { role?: string }; parts?: PromptPart[] }

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Native OpenCode Server/SDK executor. One fresh, parentless session per call. */
export class OpenCodeExecutor implements Executor {
  readonly id = 'opencode';
  readonly capabilities = {
    headless: true, interactive: true, filesystem: true, tools: true,
    custom_endpoint: true, structured_output: true,
  };

  constructor(
    private readonly timeoutMs = 600_000,
    private readonly server = new OpenCodeServerManager(),
  ) {}

  async detect(): Promise<boolean> {
    return Boolean(process.env.OPENCODE_SERVER_URL) || commandExists('opencode');
  }

  async runAgent(ctx: ExecutorContext): Promise<ExecutorResult> {
    const remoteAgent = `volibear-${ctx.agent}`;
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    ctx.abortSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    let sessionId: string | undefined;
    try {
      const connection = await this.server.acquire(ctx.cwd, controller.signal);
      const agentsResponse = await connection.client.app.agents({
        query: { directory: ctx.cwd }, throwOnError: true, signal: controller.signal,
      });
      const agents = unwrapSdkData<AgentInfo[]>(agentsResponse as never);
      if (!agents.some((agent) => agent.name === remoteAgent)) {
        return this.failure('AGENT_NOT_FOUND', `OpenCode agent "${remoteAgent}" is not installed`, false);
      }
      if (ctx.resumeSessionId) {
        const recovered = await this.recover(connection.client, ctx, ctx.resumeSessionId, remoteAgent, connection.url, startedAt, controller.signal);
        if (recovered) return recovered;
        if (ctx.agent === 'developer' || ctx.agent === 'fixer') {
          return {
            ...this.failure('SESSION_LOST', `OpenCode session "${ctx.resumeSessionId}" has no recoverable response; refusing to repeat mutating agent "${ctx.agent}"`, false),
            failure: {
              code: 'SESSION_LOST',
              message: `OpenCode session "${ctx.resumeSessionId}" has no recoverable response; mutating effects are ambiguous`,
              retryable: false,
              ambiguousSideEffects: true,
            },
          };
        }
      }
      const sessionResponse = await connection.client.session.create({
        query: { directory: ctx.cwd },
        body: { title: `Volibear ${ctx.executionId ?? ctx.agent}` },
        throwOnError: true,
        signal: controller.signal,
      });
      const session = unwrapSdkData<SessionInfo>(sessionResponse as never);
      sessionId = session.id;
      if (session.parentID) throw new Error('OpenCode created a parented session unexpectedly');
      const metadata = {
        transport: 'opencode-sdk' as const, sessionId, remoteAgent,
        serverUrl: connection.url, startedAt,
      };
      await ctx.onMetadata?.(metadata);
      const handoff = ctx.handoff ?? { schema_version: 1, task: ctx.task };
      const promptResponse = await connection.client.session.prompt({
        query: { directory: ctx.cwd },
        path: { id: sessionId },
        body: {
          agent: remoteAgent,
          parts: [{ type: 'text', text: JSON.stringify(handoff, null, 2) }],
        },
        throwOnError: true,
        signal: controller.signal,
      });
      const prompt = unwrapSdkData<PromptInfo>(promptResponse as never);
      const stdout = (prompt.parts ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
      return {
        exitCode: 0, stdout, stderr: '',
        structured: parseJsonObject(stdout) ?? { output: stdout },
        metadata: { ...metadata, completedAt: new Date().toISOString() },
      };
    } catch (error) {
      if (sessionId) {
        try {
          const connection = await this.server.acquire(ctx.cwd);
          await connection.client.session.abort({
            query: { directory: ctx.cwd }, path: { id: sessionId }, throwOnError: true,
          });
        } catch { /* retain original diagnostic */ }
      }
      const cancelled = ctx.abortSignal?.aborted === true;
      const code = timedOut ? 'TIMEOUT' : cancelled ? 'CANCELLED' : 'CONNECTION_FAILED';
      return this.failure(code, error instanceof Error ? error.message : String(error), code === 'CONNECTION_FAILED');
    } finally {
      clearTimeout(timer);
      ctx.abortSignal?.removeEventListener('abort', abort);
    }
  }

  private failure(code: NonNullable<ExecutorResult['failure']>['code'], message: string, retryable: boolean): ExecutorResult {
    return { exitCode: 1, stdout: '', stderr: message, failure: { code, message, retryable } };
  }

  private async recover(
    client: any,
    ctx: ExecutorContext,
    sessionId: string,
    remoteAgent: string,
    serverUrl: string,
    startedAt: string,
    signal: AbortSignal,
  ): Promise<ExecutorResult | undefined> {
    try {
      await client.session.get({ query: { directory: ctx.cwd }, path: { id: sessionId }, throwOnError: true, signal });
      const response = await client.session.messages({
        query: { directory: ctx.cwd }, path: { id: sessionId }, throwOnError: true, signal,
      });
      const messages = unwrapSdkData<MessageInfo[]>(response as never);
      const assistant = [...messages].reverse().find((message) => message.info?.role === 'assistant');
      const stdout = (assistant?.parts ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
      if (!stdout.trim()) return undefined;
      return {
        exitCode: 0,
        stdout,
        stderr: '',
        structured: parseJsonObject(stdout) ?? { output: stdout },
        metadata: {
          transport: 'opencode-sdk', sessionId, remoteAgent, serverUrl,
          startedAt, completedAt: new Date().toISOString(), recovered: true,
        },
      };
    } catch {
      return undefined;
    }
  }

  close(): Promise<void> {
    return this.server.close();
  }
}
