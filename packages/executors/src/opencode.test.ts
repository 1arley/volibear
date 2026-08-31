import { describe, expect, it, vi } from 'vitest';
import { ExecutorContext } from '@volibear/contracts';
import { OpenCodeExecutor } from './opencode.js';
import { OpenCodeServerManager } from './opencode-client.js';

function context(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return { cwd: '/repo', runDir: '/repo/.volibear/.runs/r1', task: 'task', agent: 'developer', ...overrides };
}

function fakeManager(agent = 'volibear-developer') {
  const create = vi.fn(async (..._args: any[]) => ({ data: { id: 'ses_1' } }));
  const prompt = vi.fn(async (..._args: any[]) => ({ data: { parts: [{ type: 'text', text: '{"summary":"done"}' }] } }));
  const agents = vi.fn(async (..._args: any[]) => ({ data: [{ name: agent, mode: 'subagent' }] }));
  const abort = vi.fn(async (..._args: any[]) => ({ data: true }));
  const manager = {
    acquire: vi.fn(async () => ({
      url: 'http://127.0.0.1:1234', ownership: 'external', close: async () => undefined,
      client: { app: { agents }, session: { create, prompt, abort } },
    })),
    close: vi.fn(async () => undefined),
  };
  return { manager: manager as unknown as OpenCodeServerManager, create, prompt, agents, abort };
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
    const promptOptions = fake.prompt.mock.calls[0][0];
    expect(promptOptions.body.agent).toBe('volibear-developer');
    expect(promptOptions.body.model).toBeUndefined();
  });

  it('creates a distinct session for each invocation', async () => {
    const fake = fakeManager();
    fake.create
      .mockResolvedValueOnce({ data: { id: 'ses_1' } })
      .mockResolvedValueOnce({ data: { id: 'ses_2' } });
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
    expect(onMetadata.mock.invocationCallOrder[0]).toBeLessThan(fake.prompt.mock.invocationCallOrder[0]);
  });

  it('closes the shared manager', async () => {
    const fake = fakeManager();
    await new OpenCodeExecutor(1_000, fake.manager).close();
    expect(fake.manager.close).toHaveBeenCalled();
  });
});
