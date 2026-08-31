import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { runInstallWizard } from './wizard.js';
import type { DetectedIntegration, InstallScope, IntegrationId } from './types.js';
import type { ExistingPathsFn } from './wizard.js';

/**
 * Minimal fake stdin that supports the stream APIs the wizard touches:
 * resume/pause, isRaw, setRawMode (guarded), and 'keypress' events.
 */
class FakeStdin extends EventEmitter {
  isRaw = false;
  paused = true;
  resume() { this.paused = false; }
  pause() { this.paused = true; }
  setRawMode(v: boolean) { this.isRaw = v; }
  /** Emit a keypress exactly as readline would. */
  press(name: string, ctrl = false) {
    this.emit('keypress', '', { name, ctrl });
  }
}

function fakeDeps(existingPaths?: ExistingPathsFn) {
  const stdin = new FakeStdin();
  const chunks: string[] = [];
  return {
    stdin,
    write: (t: string) => { chunks.push(t); },
    clear: () => {},
    exists: () => false,
    detectIntegrations: (): DetectedIntegration[] => [
      { id: 'opencode', command: 'opencode', available: true },
      { id: 'claude', command: 'claude', available: false },
      { id: 'codex', command: 'codex', available: false },
    ],
    ...(existingPaths ? { existingPaths } : {}),
    chunks,
  };
}

describe('runInstallWizard (integration)', () => {
  it('runs the full happy path and returns a confirmed selection', async () => {
    const d = fakeDeps();
    const promise = runInstallWizard(undefined, d);

    // welcome → detection → scope → integrations → pipelines → executor
    // → router → summary
    for (let i = 0; i < 7; i++) d.stdin.press('return');
    // summary → Enter to confirm
    d.stdin.press('return');

    const outcome = await promise;
    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('project');
      expect(outcome.selection.integrations).toEqual(['opencode']);
      expect(outcome.selection.pipelines).toEqual(['feature', 'fix']);
      expect(outcome.selection.executor).toBe('mock');
      expect(outcome.selection.router).toBe('native');
      expect(outcome.selection.overwriteConfigPaths).toEqual([]);
      expect(outcome.selection.overwriteIntegrationPaths).toEqual([]);
    }
    // The renderer should have emitted screen content.
    expect(d.chunks.join('').length).toBeGreaterThan(0);
  });

  it('cancels on Ctrl+C at any screen', async () => {
    const d = fakeDeps();
    const promise = runInstallWizard(undefined, d);
    d.stdin.press('c', true);
    const outcome = await promise;
    expect(outcome.kind).toBe('cancelled');
  });

  it('restores raw mode after finishing', async () => {
    const d = fakeDeps();
    const promise = runInstallWizard(undefined, d);
    d.stdin.press('c', true);
    await promise;
    expect(d.stdin.isRaw).toBe(false);
  });

  it('walks the per-path overwrite screens and returns the chosen paths', async () => {
    const projectConfig = '/work/repo/.volibear/config.yaml';
    const globalConfig = '/home/alice/.volibear/config.yaml';
    const bridge = '/work/repo/.opencode/agents/volibear.md';
    const existingPaths: ExistingPathsFn = (scope: InstallScope, integrations: IntegrationId[]) => {
      const scopes = scope === 'both' ? (['project', 'global'] as const) : ([scope] as const);
      const configs: string[] = [];
      const bridges: string[] = [];
      for (const sc of scopes) {
        if (sc === 'project') configs.push(projectConfig);
        if (sc === 'global') configs.push(globalConfig);
        if (sc === 'project' && integrations.includes('opencode')) bridges.push(bridge);
      }
      return { configs, bridges };
    };
    const d = fakeDeps(existingPaths);
    const promise = runInstallWizard(undefined, d);

    // welcome → detection → scope (project) → integrations → pipelines → executor → router
    for (let i = 0; i < 7; i++) d.stdin.press('return');
    // Now on config-overwrite: two configs listed. Overwrite only the project
    // one (cursor 0), keep the global one (HIGH-1 per-path).
    expect(d.chunks.join('')).toContain('Existing Volibear configuration');
    d.stdin.press('space'); // mark project config
    d.stdin.press('return'); // → bridge-overwrite
    // Toggle the single bridge on, then off, then on again (MED-2 reversible).
    d.stdin.press('space');
    d.stdin.press('space');
    d.stdin.press('space');
    d.stdin.press('return'); // → summary
    d.stdin.press('return'); // confirm

    const outcome = await promise;
    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.overwriteConfigPaths).toEqual([projectConfig]);
      expect(outcome.selection.overwriteIntegrationPaths).toEqual([bridge]);
    }
  });

  it('does not show overwrite screens for unselected scope (MED-3)', async () => {
    // Only the GLOBAL config exists. The wizard stays on project scope, so
    // the config-overwrite prompt must never appear. The callback records
    // every query so we can assert the wizard only asks about the CURRENT
    // selection — never about 'global'/'both' or an unselected integration.
    const calls: Array<{ scope: InstallScope; integrations: IntegrationId[] }> = [];
    const existingPaths: ExistingPathsFn = (scope, integrations) => {
      calls.push({ scope, integrations: [...integrations] });
      const scopes = scope === 'both' ? (['project', 'global'] as const) : ([scope] as const);
      const configs: string[] = [];
      if (scopes.includes('global')) configs.push('/home/alice/.volibear/config.yaml');
      return { configs, bridges: [] };
    };
    const d = fakeDeps(existingPaths);
    const promise = runInstallWizard(undefined, d);
    // 7 Enters reach the summary only when NO overwrite screen is inserted.
    for (let i = 0; i < 7; i++) d.stdin.press('return');
    d.stdin.press('return'); // confirm on summary

    const outcome = await promise;
    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('project');
      expect(outcome.selection.overwriteConfigPaths).toEqual([]);
    }
    // The wizard queried existing paths, but only for the selected scope and
    // the selected integrations (opencode was the only detected CLI).
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.scope).toBe('project');
      expect(call.integrations).toEqual(['opencode']);
    }
  });

  it('cleans up raw mode and pauses when stdin.resume() throws during setup (MED-5)', async () => {
    const d = fakeDeps();
    d.stdin.resume = () => {
      throw new Error('resume failed');
    };
    const promise = runInstallWizard(undefined, d);
    await expect(promise).rejects.toThrow('resume failed');
    // cleanup must have restored raw mode and paused the stream.
    expect(d.stdin.isRaw).toBe(false);
    expect(d.stdin.paused).toBe(true);
  });
});
