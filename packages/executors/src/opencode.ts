import { commandExists } from './base.js';
import { Executor, ExecutorContext, ExecutorResult } from '@volibear/contracts';
import { OpenCodeServerManager, unwrapSdkData } from './opencode-client.js';

interface AgentInfo { name?: string }
interface SessionInfo { id: string; parentID?: string }
interface PromptPart { type?: string; text?: string }
interface MessageInfo { info?: { role?: string }; parts?: PromptPart[] }
interface OpenCodeEvent { type?: string; properties?: Record<string, any> }

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
      await this.toast(connection.client, ctx.cwd, `Volibear ${ctx.agent} started`, 'info');
      const waiting = this.waitForSession(connection.client, ctx, sessionId, metadata, controller.signal);
      await connection.client.session.promptAsync({
        query: { directory: ctx.cwd },
        path: { id: sessionId },
        body: {
          agent: remoteAgent,
          parts: [{ type: 'text', text: JSON.stringify(handoff, null, 2) }],
        },
        throwOnError: true,
        signal: controller.signal,
      });
      const eventMetadata = await waiting;
      const stdout = await this.readLatestAssistant(connection.client, ctx.cwd, sessionId, controller.signal);
      await this.toast(connection.client, ctx.cwd, `Volibear ${ctx.agent} completed`, 'success');
      return {
        exitCode: 0, stdout, stderr: '',
        structured: parseJsonObject(stdout) ?? { output: stdout },
        metadata: { ...metadata, ...eventMetadata, completedAt: new Date().toISOString() },
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
      let recoveredOutput = stdout;
      let eventMetadata: Partial<import('@volibear/contracts').ExecutorMetadata> = {};
      if (!recoveredOutput.trim()) {
        const statusesResponse = await client.session.status({
          query: { directory: ctx.cwd }, throwOnError: true, signal,
        });
        const statuses = unwrapSdkData<Record<string, { type?: string }>>(statusesResponse as never) ?? {};
        if (statuses[sessionId]?.type !== 'idle') {
          eventMetadata = await this.waitForSession(client, ctx, sessionId, {
            transport: 'opencode-sdk', sessionId, remoteAgent, serverUrl, startedAt,
          }, signal);
          recoveredOutput = await this.readLatestAssistant(client, ctx.cwd, sessionId, signal);
        }
      }
      if (!recoveredOutput.trim()) return undefined;
      return {
        exitCode: 0,
        stdout: recoveredOutput,
        stderr: '',
        structured: parseJsonObject(recoveredOutput) ?? { output: recoveredOutput },
        metadata: {
          transport: 'opencode-sdk', sessionId, remoteAgent, serverUrl,
          startedAt, completedAt: new Date().toISOString(), recovered: true, ...eventMetadata,
        },
      };
    } catch {
      return undefined;
    }
  }

  private async waitForSession(
    client: any,
    ctx: ExecutorContext,
    sessionId: string,
    metadata: import('@volibear/contracts').ExecutorMetadata,
    signal: AbortSignal,
  ): Promise<Partial<import('@volibear/contracts').ExecutorMetadata>> {
    const subscription = await client.event.subscribe({
      query: { directory: ctx.cwd }, throwOnError: true, signal,
    });
    let lastEventAt: string | undefined;
    let messageId: string | undefined;
    for await (const raw of subscription.stream as AsyncIterable<OpenCodeEvent>) {
      const event = raw as OpenCodeEvent;
      const properties = event.properties ?? {};
      const eventSessionId = properties.sessionID ?? properties.part?.sessionID;
      if (eventSessionId !== sessionId) continue;
      lastEventAt = new Date().toISOString();
      messageId = properties.messageID ?? properties.part?.messageID ?? messageId;

      if (event.type === 'message.part.updated') {
        const delta = properties.delta;
        if (typeof delta === 'string' && delta) ctx.onOutput?.(delta);
      }
      if (event.type === 'session.error') {
        await ctx.onMetadata?.({ ...metadata, messageId, lastEventAt, remoteStatus: 'error' });
        throw new Error(`OpenCode session ${sessionId} failed: ${JSON.stringify(properties.error ?? 'unknown error')}`);
      }
      if (event.type === 'permission.updated') {
        const response = this.permissionResponse(ctx, String(properties.type ?? ''));
        ctx.onOutput?.(`\n[opencode] permission ${response === 'once' ? 'allowed' : 'rejected'}: ${properties.title ?? properties.type ?? properties.id}\n`);
        await client.postSessionIdPermissionsPermissionId({
          query: { directory: ctx.cwd },
          path: { id: sessionId, permissionID: properties.id },
          body: { response },
          throwOnError: true,
          signal,
        });
        await this.toast(client, ctx.cwd, `Permission ${response === 'once' ? 'allowed' : 'rejected'}: ${properties.title ?? properties.type}`, response === 'once' ? 'info' : 'warning');
      }
      if (event.type === 'session.status') {
        const status = properties.status?.type as 'busy' | 'idle' | 'retry' | undefined;
        if (status) await ctx.onMetadata?.({ ...metadata, messageId, lastEventAt, remoteStatus: status });
        if (status === 'idle') return { messageId, lastEventAt, remoteStatus: 'idle' };
      }
      if (event.type === 'session.idle') {
        await ctx.onMetadata?.({ ...metadata, messageId, lastEventAt, remoteStatus: 'idle' });
        return { messageId, lastEventAt, remoteStatus: 'idle' };
      }
    }
    throw new Error(`OpenCode event stream closed before session ${sessionId} became idle`);
  }

  private permissionResponse(ctx: ExecutorContext, type: string): 'once' | 'reject' {
    const normalized = type.toLowerCase();
    if (['edit', 'write', 'apply_patch'].some((name) => normalized.includes(name))) {
      return ctx.permissions?.repository === 'write' ? 'once' : 'reject';
    }
    if (['bash', 'shell'].some((name) => normalized.includes(name))) {
      return ctx.permissions?.shell === 'full' ? 'once' : 'reject';
    }
    if (['web', 'network', 'fetch'].some((name) => normalized.includes(name))) {
      return ctx.permissions?.network === true ? 'once' : 'reject';
    }
    return 'reject';
  }

  private async readLatestAssistant(
    client: any,
    cwd: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await client.session.messages({
      query: { directory: cwd }, path: { id: sessionId }, throwOnError: true, signal,
    });
    const messages = unwrapSdkData<MessageInfo[]>(response as never);
    const assistant = [...messages].reverse().find((message) => message.info?.role === 'assistant');
    return (assistant?.parts ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }

  private async toast(client: any, cwd: string, message: string, variant: string): Promise<void> {
    try {
      await client.tui?.showToast({ query: { directory: cwd }, body: { message, variant } });
    } catch { /* TUI is optional for headless/external servers. */ }
  }

  close(): Promise<void> {
    return this.server.close();
  }
}
