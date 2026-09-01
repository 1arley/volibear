import { describe, expect, it, vi } from 'vitest';
import { ExecutorContext } from '@volibear/contracts';
import { OpenCodeExecutor } from './opencode.js';
import { OpenCodeServerManager } from './opencode-client.js';

function context(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return { cwd: '/repo', runDir: '/repo/.volibear/.runs/r1', task: 'task', agent: 'developer', ...overrides };
}

function fakeManager(agent = 'volibear-developer') {
  const create = vi.fn(async (options: any) => options?.body?.parentID
    ? ({ data: { id: 'ses_child', parentID: options.body.parentID } })
    : ({ data: { id: 'ses_1' } }));
  const promptAsync = vi.fn(async (..._args: any[]) => ({ data: undefined }));
  const messages = vi.fn(async (..._args: any[]) => ({ data: [{ info: { id: 'msg_assistant', role: 'assistant', parentID: 'msg_native_test' }, parts: [{ type: 'text', text: '{"summary":"done"}' }] }] }));
  const agents = vi.fn(async (..._args: any[]) => ({ data: [{ name: 'volibear', mode: 'primary' }, { name: agent, mode: 'subagent' }] }));
  const abort = vi.fn(async (..._args: any[]) => ({ data: true }));
  const get = vi.fn(async (..._args: any[]) => ({ data: { id: 'ses_primary' } }));
  const subscribe = vi.fn(async (..._args: any[]) => ({
    stream: (async function* () {
      yield { type: 'message.part.updated', properties: { part: { sessionID: 'ses_1', messageID: 'msg_1' }, delta: 'chunk' } };
      yield { type: 'session.idle', properties: { sessionID: 'ses_1' } };
    })(),
  }));
  const showToast = vi.fn(async (..._args: any[]) => ({ data: true }));
  const replyPermission = vi.fn(async (..._args: any[]) => ({ data: true }));
  const manager = {
    acquire: vi.fn(async () => ({
      url: 'http://127.0.0.1:1234', ownership: 'external', close: async () => undefined,
      client: { app: { agents }, session: { create, get, promptAsync, messages, abort }, event: { subscribe }, tui: { showToast }, postSessionIdPermissionsPermissionId: replyPermission },
    })),
    close: vi.fn(async () => undefined),
  };
  return { manager: manager as unknown as OpenCodeServerManager, create, get, promptAsync, messages, agents, abort, subscribe, showToast, replyPermission };
}

describe('OpenCodeExecutor SDK transport', () => {
  it('creates one primary session and recovers the persisted session', async () => {
    const fake = fakeManager();
    const executor = new OpenCodeExecutor(1_000, fake.manager);
    const created = await executor.ensureNativeSession({ cwd: '/repo', runId: 'run-1' });
    const recovered = await executor.ensureNativeSession({ cwd: '/repo', runId: 'run-1', resumeSessionId: 'ses_primary' });

    expect(created.nativeSessionId).toBe('ses_1');
    expect(recovered).toEqual(expect.objectContaining({ nativeSessionId: 'ses_primary', recovered: true }));
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.get).toHaveBeenCalledTimes(1);
  });

  it('fails when a persisted primary session cannot be recovered', async () => {
    const fake = fakeManager();
    fake.get.mockRejectedValueOnce(new Error('not found'));
    await expect(new OpenCodeExecutor(1_000, fake.manager).ensureNativeSession({
      cwd: '/repo', runId: 'run-1', resumeSessionId: 'ses_lost',
    })).rejects.toThrow('could not be recovered');
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('selects volibear role agent in a fresh session without model or parentID', async () => {
    const fake = fakeManager();
    const executor = new OpenCodeExecutor(1_000, fake.manager);
    const result = await executor.runAgent(context({ model: 'must-not-be-forwarded' }));

    expect(result.exitCode).toBe(0);
    expect(result.structured).toEqual({ summary: 'done' });
    expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.not.objectContaining({ parentID: expect.anything() }),
    }));
    const promptOptions = fake.promptAsync.mock.calls[0][0];
    expect(promptOptions.body.agent).toBe('volibear-developer');
    expect(promptOptions.body.model).toBeUndefined();
  });

  it('creates a distinct session for each invocation', async () => {
    const fake = fakeManager();
    fake.create
      .mockResolvedValueOnce({ data: { id: 'ses_1' } })
      .mockResolvedValueOnce({ data: { id: 'ses_2' } });
    fake.subscribe
      .mockResolvedValueOnce({ stream: (async function* () { yield { type: 'session.idle', properties: { sessionID: 'ses_1' } }; })() })
      .mockResolvedValueOnce({ stream: (async function* () { yield { type: 'session.idle', properties: { sessionID: 'ses_2' } }; })() });
    const executor = new OpenCodeExecutor(1_000, fake.manager);
    const first = await executor.runAgent(context());
    const second = await executor.runAgent(context());
    expect(first.metadata?.sessionId).toBe('ses_1');
    expect(second.metadata?.sessionId).toBe('ses_2');
  });

  it('delegates as a native subtask in the caller-owned primary session', async () => {
    const fake = fakeManager();
    fake.messages
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ info: { id: 'msg_assistant', role: 'assistant', parentID: 'msg_native_test_child' }, parts: [{ type: 'text', text: '{"summary":"done"}' }] }] });
    (fake.subscribe as any).mockResolvedValueOnce({ stream: (async function* () {
      yield { type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_primary' } } };
      yield { type: 'message.part.updated', properties: { part: { sessionID: 'ses_child', messageID: 'msg_child' }, delta: 'child progress' } };
      yield { type: 'session.idle', properties: { sessionID: 'ses_child' } };
      yield { type: 'session.idle', properties: { sessionID: 'ses_primary' } };
    })() });
    const executor = new OpenCodeExecutor(1_000, fake.manager);
    const result = await executor.runAgent(context({ nativeSessionId: 'ses_primary', nativeRequestMessageId: 'msg_native_test' }));

    expect(result.exitCode).toBe(0);
    expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ parentID: 'ses_primary' }) }));
    expect(fake.promptAsync).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: { id: 'ses_primary' },
      body: {
        parts: [{
          type: 'subtask',
          agent: 'volibear-developer',
          description: 'Volibear developer stage',
          prompt: expect.stringContaining('schema_version'),
        }],
        agent: 'volibear',
        messageID: 'msg_native_test',
        noReply: true,
      },
    }));
    expect(fake.promptAsync).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: { id: 'ses_child' },
      body: expect.objectContaining({ agent: 'volibear-developer', messageID: 'msg_native_test_child' }),
    }));
    expect(result.metadata?.sessionId).toBe('ses_child');
    expect(result.metadata?.childSessionId).toBe('ses_child');
  });

  it('does not replay a native mutating subtask with ambiguous side effects', async () => {
    const fake = fakeManager();
    fake.messages.mockResolvedValueOnce({ data: [{ info: { id: 'msg_native_lost', role: 'user', parentID: '' }, parts: [] }] });
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      nativeSessionId: 'ses_primary', nativeRequestMessageId: 'msg_native_lost', agent: 'developer',
    }));

    expect(result.failure).toEqual(expect.objectContaining({ code: 'SESSION_LOST', ambiguousSideEffects: true }));
    expect(fake.promptAsync).not.toHaveBeenCalled();
  });

  it('recovers the persisted child response for a lost read-only native subtask', async () => {
    const fake = fakeManager('volibear-reviewer');
    fake.get.mockResolvedValueOnce({ data: { id: 'ses_lost_child', parentID: 'ses_primary' } } as never);
    fake.messages.mockResolvedValueOnce({
      data: [{ info: { id: 'msg_rec', role: 'assistant', parentID: 'msg_native_test_child' }, parts: [{ type: 'text', text: '{"summary":"recovered"}' }] }],
    });
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      agent: 'reviewer',
      nativeSessionId: 'ses_primary',
      nativeRequestMessageId: 'msg_native_test',
      resumeChildSessionId: 'ses_lost_child',
    }));

    expect(result.exitCode).toBe(0);
    expect(result.structured).toEqual({ summary: 'recovered' });
    expect(result.metadata).toEqual(expect.objectContaining({ recovered: true, childSessionId: 'ses_lost_child' }));
    expect(fake.promptAsync).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('maps cancellation and aborts the active primary session', async () => {
    const fake = fakeManager();
    fake.messages.mockResolvedValue({ data: [] });
    fake.promptAsync
      .mockResolvedValueOnce({ data: undefined })
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    const controller = new AbortController();
    controller.abort();
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      nativeSessionId: 'ses_primary', nativeRequestMessageId: 'msg_cancel', abortSignal: controller.signal,
    }));

    expect(result.failure?.code).toBe('CANCELLED');
    expect(fake.abort).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'ses_child' } }));
  });

  it('fails clearly when the installed role agent is missing', async () => {
    const fake = fakeManager('another-agent');
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context());
    expect(result.failure?.code).toBe('AGENT_NOT_FOUND');
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('persists session metadata before prompting', async () => {
    const fake = fakeManager();
    const onMetadata = vi.fn();
    await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({ onMetadata }));
    expect(onMetadata).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ses_1', remoteAgent: 'volibear-developer', transport: 'opencode-sdk',
    }));
    expect(onMetadata.mock.invocationCallOrder[0]).toBeLessThan(fake.promptAsync.mock.invocationCallOrder[0]);
  });

  it('streams OpenCode events and reports the terminal remote status', async () => {
    const fake = fakeManager();
    const onOutput = vi.fn();
    const onMetadata = vi.fn();
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({ onOutput, onMetadata }));
    expect(onOutput).toHaveBeenCalledWith('chunk');
    expect(result.metadata).toEqual(expect.objectContaining({ messageId: 'msg_1', remoteStatus: 'idle' }));
    expect(fake.subscribe).toHaveBeenCalled();
    expect(fake.showToast).toHaveBeenCalledTimes(2);
  });

  it('resolves OpenCode permission prompts from the stage policy', async () => {
    const fake = fakeManager();
    fake.subscribe.mockResolvedValueOnce({ stream: (async function* () {
      yield { type: 'permission.updated', properties: { id: 'perm_1', sessionID: 'ses_1', type: 'edit', title: 'Edit file' } };
      yield { type: 'session.idle', properties: { sessionID: 'ses_1' } };
    })() });
    await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      permissions: { repository: 'write', shell: 'denied', network: false },
    }));
    expect(fake.replyPermission).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_1', permissionID: 'perm_1' }, body: { response: 'once' },
    }));
  });

  it('closes the shared manager', async () => {
    const fake = fakeManager();
    await new OpenCodeExecutor(1_000, fake.manager).close();
    expect(fake.manager.close).toHaveBeenCalled();
  });

  it('aborts the SSE subscription when the native wait returns at idle', async () => {
    const fake = fakeManager();
    let sseSignal: AbortSignal | undefined;
    fake.subscribe.mockImplementationOnce(async (options: any) => {
      sseSignal = options.signal;
      return { stream: (async function* () {
        yield { type: 'session.idle', properties: { sessionID: 'ses_child' } };
        yield { type: 'session.idle', properties: { sessionID: 'ses_primary' } };
      })() };
    });
    fake.messages
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ info: { id: 'msg_assistant', role: 'assistant', parentID: 'msg_native_test_child' }, parts: [{ type: 'text', text: '{"summary":"done"}' }] }] });
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      nativeSessionId: 'ses_primary', nativeRequestMessageId: 'msg_native_test',
    }));
    expect(result.exitCode).toBe(0);
    expect(sseSignal?.aborted).toBe(true);
  });

  it('aborts the SSE subscription when the stream closes before idle', async () => {
    const fake = fakeManager();
    let sseSignal: AbortSignal | undefined;
    fake.subscribe.mockImplementationOnce(async (options: any) => {
      sseSignal = options.signal;
      return { stream: (async function* () { /* closes without idle */ })() };
    });
    const result = await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      nativeSessionId: 'ses_primary', nativeRequestMessageId: 'msg_native_test',
    }));
    expect(result.failure?.code).toBe('CONNECTION_FAILED');
    expect(sseSignal?.aborted).toBe(true);
  });

  it('propagates external cancellation to the SSE subscription signal', async () => {
    const fake = fakeManager();
    let sseSignal: AbortSignal | undefined;
    fake.subscribe.mockImplementationOnce(async (options: any) => {
      sseSignal = options.signal;
      return { stream: (async function* () {
        yield { type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_primary' } } } as any;
        yield { type: 'session.error', properties: { sessionID: 'ses_child', error: { name: 'SessionError' } } } as any;
      })() };
    });
    const controller = new AbortController();
    controller.abort();
    await new OpenCodeExecutor(1_000, fake.manager).runAgent(context({
      nativeSessionId: 'ses_primary', nativeRequestMessageId: 'msg_cancel', abortSignal: controller.signal,
    }));
    expect(sseSignal?.aborted).toBe(true);
  });
});
