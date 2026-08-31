import { describe, expect, it, vi } from 'vitest';
import { ExecutorContext } from '@volibear/contracts';
import { OpenCodeExecutor } from './opencode.js';
import { OpenCodeServerManager } from './opencode-client.js';

function context(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return { cwd: '/repo', runDir: '/repo/.volibear/.runs/r1', task: 'task', agent: 'developer', ...overrides };
}

function fakeManager(agent = 'volibear-developer') {
  const create = vi.fn(async (..._args: any[]) => ({ data: { id: 'ses_1' } }));
  const promptAsync = vi.fn(async (..._args: any[]) => ({ data: undefined }));
  const messages = vi.fn(async (..._args: any[]) => ({ data: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: '{"summary":"done"}' }] }] }));
  const agents = vi.fn(async (..._args: any[]) => ({ data: [{ name: agent, mode: 'subagent' }] }));
  const abort = vi.fn(async (..._args: any[]) => ({ data: true }));
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
      client: { app: { agents }, session: { create, promptAsync, messages, abort }, event: { subscribe }, tui: { showToast }, postSessionIdPermissionsPermissionId: replyPermission },
    })),
    close: vi.fn(async () => undefined),
  };
  return { manager: manager as unknown as OpenCodeServerManager, create, promptAsync, messages, agents, abort, subscribe, showToast, replyPermission };
}

describe('OpenCodeExecutor SDK transport', () => {
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
});
