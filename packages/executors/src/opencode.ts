import { commandExists } from './base.js';
import { Executor, ExecutorContext, ExecutorResult } from '@volibear/contracts';
import { OpenCodeServerManager, unwrapSdkData } from './opencode-client.js';

interface AgentInfo { name?: string; mode?: string }
interface SessionInfo { id: string; parentID?: string }
interface PromptPart {
  type?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; output?: string; metadata?: { sessionId?: string } };
}
interface MessageInfo { info?: { id?: string; role?: string; parentID?: string }; parts?: PromptPart[] }
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

/** OpenCode executor. Native delegation uses a caller-owned primary session;
 * headless invocations retain the legacy independent-session transport. */
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

  async ensureNativeSession(ctx: {
    cwd: string;
    runId: string;
    resumeSessionId?: string;
    abortSignal?: AbortSignal;
  }): Promise<import('@volibear/contracts').ExecutorMetadata> {
    const connection = await this.server.acquire(ctx.cwd, ctx.abortSignal);
    const agentsResponse = await connection.client.app.agents({
      query: { directory: ctx.cwd }, throwOnError: true, signal: ctx.abortSignal,
    });
    const agents = unwrapSdkData<AgentInfo[]>(agentsResponse as never);
    const primary = agents.find((agent) => agent.name === 'volibear');
    if (!primary || (primary.mode !== undefined && primary.mode !== 'primary' && primary.mode !== 'all')) {
      throw new Error('OpenCode primary agent "volibear" is not installed as mode: primary');
    }
    if (ctx.resumeSessionId) {
      try {
        const response = await connection.client.session.get({
          query: { directory: ctx.cwd },
          path: { id: ctx.resumeSessionId },
          throwOnError: true,
          signal: ctx.abortSignal,
        });
        const session = unwrapSdkData<SessionInfo>(response as never);
        if (session.parentID) throw new Error(`persisted session ${session.id} is not a primary session`);
        return {
          transport: 'opencode-sdk',
          sessionId: session.id,
          nativeSessionId: session.id,
          serverUrl: connection.url,
          recovered: true,
        };
      } catch (error) {
        throw new Error(`persisted primary session "${ctx.resumeSessionId}" could not be recovered: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const response = await connection.client.session.create({
      query: { directory: ctx.cwd },
      body: { title: `Volibear ${ctx.runId}` },
      throwOnError: true,
      signal: ctx.abortSignal,
    });
    const session = unwrapSdkData<SessionInfo>(response as never);
    if (session.parentID) throw new Error(`OpenCode created primary session ${session.id} with unexpected parent ${session.parentID}`);
    return {
      transport: 'opencode-sdk',
      sessionId: session.id,
      nativeSessionId: session.id,
      serverUrl: connection.url,
    };
  }

  async runAgent(ctx: ExecutorContext): Promise<ExecutorResult> {
    const remoteAgent = `volibear-${ctx.agent}`;
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (ctx.abortSignal?.aborted) controller.abort();
    else ctx.abortSignal?.addEventListener('abort', abort, { once: true });
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
      if (ctx.nativeSessionId) {
        const requestMessageId = ctx.nativeRequestMessageId ?? `msg_volibear_${ctx.executionId ?? Date.now()}`;
        const childMessageId = `${requestMessageId}_child`;
        if (ctx.resumeChildSessionId) {
          const recovered = await this.recoverNative(
            connection.client, ctx, ctx.nativeSessionId, ctx.resumeChildSessionId,
            childMessageId, requestMessageId, remoteAgent, connection.url, startedAt, controller.signal,
          );
          if (recovered) return recovered;
        }
        const descriptorExists = await this.hasRequestMessage(
          connection.client, ctx.cwd, ctx.nativeSessionId, requestMessageId, controller.signal,
        );
        if (ctx.agent === 'developer' || ctx.agent === 'fixer') {
          if (descriptorExists || ctx.resumeChildSessionId) return {
            ...this.failure('SESSION_LOST', `OpenCode native subtask "${requestMessageId}" has no recoverable response`, false),
            failure: {
              code: 'SESSION_LOST',
              message: `OpenCode native ${ctx.agent} subtask may have changed the repository; refusing to replay it`,
              retryable: false,
              ambiguousSideEffects: true,
            },
          };
        }
        const baseMetadata = {
          transport: 'opencode-sdk' as const,
          nativeSessionId: ctx.nativeSessionId,
          requestMessageId,
          remoteAgent,
          serverUrl: connection.url,
          startedAt,
        };
        await ctx.onMetadata?.(baseMetadata);
        const handoff = ctx.handoff ?? { schema_version: 1, task: ctx.task };
        if (!descriptorExists) {
          await connection.client.session.promptAsync({
            query: { directory: ctx.cwd },
            path: { id: ctx.nativeSessionId },
            body: {
              messageID: requestMessageId,
              agent: 'volibear',
              noReply: true,
              parts: [{
                type: 'subtask',
                agent: remoteAgent,
                description: `Volibear ${ctx.agent} stage`,
                prompt: JSON.stringify(handoff, null, 2),
              }],
            },
            throwOnError: true,
            signal: controller.signal,
          });
        }
        const childResponse = await connection.client.session.create({
          query: { directory: ctx.cwd },
          body: { parentID: ctx.nativeSessionId, title: `Volibear ${ctx.agent} stage` },
          throwOnError: true,
          signal: controller.signal,
        });
        const child = unwrapSdkData<SessionInfo>(childResponse as never);
        if (child.parentID !== ctx.nativeSessionId) throw new Error(`OpenCode child ${child.id} is not attached to primary session ${ctx.nativeSessionId}`);
        sessionId = child.id;
        const metadata = { ...baseMetadata, sessionId: child.id, childSessionId: child.id };
        await ctx.onMetadata?.(metadata);
        const waiting = this.waitForSession(connection.client, ctx, child.id, metadata, controller.signal);
        try {
          await connection.client.session.promptAsync({
            query: { directory: ctx.cwd }, path: { id: child.id },
            body: {
              messageID: childMessageId,
              agent: remoteAgent,
              parts: [{ type: 'text', text: JSON.stringify(handoff, null, 2) }],
            },
            throwOnError: true,
            signal: controller.signal,
          });
        } catch (error) {
          controller.abort();
          await waiting.catch(() => undefined);
          throw error;
        }
        const eventMetadata = await waiting;
        const stdout = await this.readNativeResult(connection.client, ctx.cwd, child.id, childMessageId, controller.signal);
        if (!stdout.trim()) return this.failure('INVALID_OUTPUT', `OpenCode native subtask "${requestMessageId}" completed without a correlated response`, false);
        return {
          exitCode: 0,
          stdout,
          stderr: '',
          structured: parseJsonObject(stdout) ?? { output: stdout },
          metadata: { ...metadata, ...eventMetadata, completedAt: new Date().toISOString() },
        };
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
      try {
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
      } catch (error) {
        controller.abort();
        await waiting.catch(() => undefined);
        throw error;
      }
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

  private async recoverNative(
    client: any,
    ctx: ExecutorContext,
    primarySessionId: string,
    childSessionId: string,
    childMessageId: string,
    requestMessageId: string,
    remoteAgent: string,
    serverUrl: string,
    startedAt: string,
    signal: AbortSignal,
  ): Promise<ExecutorResult | undefined> {
    try {
      const response = await client.session.get({ query: { directory: ctx.cwd }, path: { id: childSessionId }, throwOnError: true, signal });
      const child = unwrapSdkData<SessionInfo>(response as never);
      if (child.parentID !== primarySessionId) return undefined;
      const stdout = await this.readNativeResult(client, ctx.cwd, childSessionId, childMessageId, signal);
      if (!stdout.trim()) return undefined;
      return {
        exitCode: 0,
        stdout,
        stderr: '',
        structured: parseJsonObject(stdout) ?? { output: stdout },
        metadata: {
          transport: 'opencode-sdk', sessionId: childSessionId, nativeSessionId: primarySessionId,
          childSessionId, requestMessageId, remoteAgent, serverUrl, startedAt,
          completedAt: new Date().toISOString(), recovered: true, remoteStatus: 'idle',
        },
      };
    } catch {
      return undefined;
    }
  }

  private async hasRequestMessage(client: any, cwd: string, sessionId: string, requestMessageId: string, signal: AbortSignal): Promise<boolean> {
    const response = await client.session.messages({
      query: { directory: cwd }, path: { id: sessionId }, throwOnError: true, signal,
    });
    return unwrapSdkData<MessageInfo[]>(response as never).some((message) => message.info?.id === requestMessageId);
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
    const sseAbort = new AbortController();
    const relay = () => sseAbort.abort();
    if (signal.aborted) sseAbort.abort();
    else signal.addEventListener('abort', relay, { once: true });
    const closeStream = () => sseAbort.abort();
    try {
      const subscription = await client.event.subscribe({
        query: { directory: ctx.cwd }, throwOnError: true, signal: sseAbort.signal,
      });
      let lastEventAt: string | undefined;
      let messageId: string | undefined;
      let childSessionId: string | undefined = metadata.childSessionId;
      const relatedSessions = new Set([sessionId]);
      for await (const raw of subscription.stream as AsyncIterable<OpenCodeEvent>) {
        const event = raw as OpenCodeEvent;
        const properties = event.properties ?? {};
        if (event.type === 'session.created' && properties.info?.parentID === sessionId) {
          childSessionId = properties.info.id;
          if (childSessionId) relatedSessions.add(childSessionId);
          await ctx.onMetadata?.({ ...metadata, childSessionId, lastEventAt: new Date().toISOString(), remoteStatus: 'busy' });
        }
        const eventSessionId = properties.sessionID ?? properties.part?.sessionID ?? properties.info?.id;
        if (!relatedSessions.has(eventSessionId)) continue;
        lastEventAt = new Date().toISOString();
        messageId = properties.messageID ?? properties.part?.messageID ?? messageId;

        if (event.type === 'message.part.updated') {
          const delta = properties.delta;
          if (typeof delta === 'string' && delta) ctx.onOutput?.(delta);
        }
        if (event.type === 'session.error') {
          closeStream();
          await ctx.onMetadata?.({ ...metadata, messageId, childSessionId, lastEventAt, remoteStatus: 'error' });
          throw new Error(`OpenCode session ${eventSessionId} failed: ${JSON.stringify(properties.error ?? 'unknown error')}`);
        }
        if (event.type === 'permission.updated') {
          const response = this.permissionResponse(ctx, String(properties.type ?? ''));
          ctx.onOutput?.(`\n[opencode] permission ${response === 'once' ? 'allowed' : 'rejected'}: ${properties.title ?? properties.type ?? properties.id}\n`);
          await client.postSessionIdPermissionsPermissionId({
            query: { directory: ctx.cwd },
            path: { id: eventSessionId, permissionID: properties.id },
            body: { response },
            throwOnError: true,
            signal,
          });
          await this.toast(client, ctx.cwd, `Permission ${response === 'once' ? 'allowed' : 'rejected'}: ${properties.title ?? properties.type}`, response === 'once' ? 'info' : 'warning');
        }
        if (event.type === 'session.status') {
          const status = properties.status?.type as 'busy' | 'idle' | 'retry' | undefined;
          if (status) await ctx.onMetadata?.({ ...metadata, messageId, childSessionId, lastEventAt, remoteStatus: status });
          if (eventSessionId === sessionId && status === 'idle') {
            closeStream();
            return { messageId, childSessionId, lastEventAt, remoteStatus: 'idle' };
          }
        }
        if (event.type === 'session.idle') {
          await ctx.onMetadata?.({ ...metadata, messageId, childSessionId, lastEventAt, remoteStatus: 'idle' });
          if (eventSessionId === sessionId) {
            closeStream();
            return { messageId, childSessionId, lastEventAt, remoteStatus: 'idle' };
          }
        }
      }
      throw new Error(`OpenCode event stream closed before session ${sessionId} became idle`);
    } finally {
      signal.removeEventListener('abort', relay);
      closeStream();
    }
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

  private async readNativeResult(client: any, cwd: string, sessionId: string, requestMessageId: string, signal: AbortSignal): Promise<string> {
    const response = await client.session.messages({
      query: { directory: cwd }, path: { id: sessionId }, throwOnError: true, signal,
    });
    const messages = unwrapSdkData<MessageInfo[]>(response as never);
    const assistant = [...messages].reverse().find(
      (message) => message.info?.role === 'assistant' && message.info.parentID === requestMessageId,
    );
    const text = (assistant?.parts ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    if (text.trim()) return text;
    return (assistant?.parts ?? [])
      .filter((part) => part.type === 'tool' && part.tool === 'task' && part.state?.status === 'completed' && typeof part.state.output === 'string')
      .map((part) => part.state!.output!)
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
