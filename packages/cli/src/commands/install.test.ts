import { describe, it, expect } from 'vitest';
import {
  shouldUseInstallWizard,
  selectionFromFlags,
  resolveInstallRequest,
} from './install.js';

describe('shouldUseInstallWizard', () => {
  it('uses wizard on TTY without flags', () => {
    expect(shouldUseInstallWizard([], {}, true)).toBe(true);
  });

  it('skips wizard with any install flag even on TTY', () => {
    expect(shouldUseInstallWizard([], { project: true }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { global: true }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { both: true }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { executor: 'claude' }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { router: '9router' }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { pipeline: 'fix' }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { acceptDefaults: true }, true)).toBe(false);
    expect(shouldUseInstallWizard([], { force: true }, true)).toBe(false);
  });

  it('skips wizard with positionals', () => {
    expect(shouldUseInstallWizard(['opencode'], {}, true)).toBe(false);
  });

  it('never uses wizard on non-TTY stdin', () => {
    expect(shouldUseInstallWizard([], {}, false)).toBe(false);
  });
});

describe('selectionFromFlags', () => {
  it('defaults to project scope, feature+fix pipelines, mock executor, native router', () => {
    const r = selectionFromFlags([], {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.selection.scope).toBe('project');
    expect(r.selection.pipelines).toEqual(['feature', 'fix']);
    expect(r.selection.executor).toBe('mock');
    expect(r.selection.router).toBe('native');
    expect(r.selection.integrations).toEqual([]);
    expect(r.selection.force).toBe(false);
  });

  it('resolves --both to both scopes', () => {
    const r = selectionFromFlags([], { both: true });
    if (!r.ok) throw new Error('expected ok');
    expect(r.selection.scope).toBe('both');
  });

  it('rejects conflicting scopes', () => {
    const r = selectionFromFlags([], { project: true, global: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/only one installation scope/);
  });

  it('rejects conflicting --both + --project', () => {
    const r = selectionFromFlags([], { project: true, both: true });
    expect(r.ok).toBe(false);
  });

  it('accepts positional integrations', () => {
    const r = selectionFromFlags(['opencode', 'codex'], {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.selection.integrations).toEqual(['opencode', 'codex']);
  });

  it('rejects unknown integrations', () => {
    const r = selectionFromFlags(['gemini'], {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown integration "gemini"/);
  });

  it('honors --executor and --router', () => {
    const r = selectionFromFlags([], { executor: 'claude', router: '9router' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.selection.executor).toBe('claude');
    expect(r.selection.router).toBe('9router');
  });

  it('rejects unknown executor and router', () => {
    expect(selectionFromFlags([], { executor: 'gemini' }).ok).toBe(false);
    expect(selectionFromFlags([], { router: 'bogus' }).ok).toBe(false);
  });

  it('restricts --pipeline to a single known pipeline', () => {
    const r = selectionFromFlags([], { pipeline: 'fix' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.selection.pipelines).toEqual(['fix']);
    expect(selectionFromFlags([], { pipeline: 'bogus' }).ok).toBe(false);
  });

  it('legacy positional scope "global" still works', () => {
    const r = selectionFromFlags(['global', 'claude'], {});
    if (!r.ok) throw new Error('expected ok');
    expect(r.selection.scope).toBe('global');
    expect(r.selection.integrations).toEqual(['claude']);
  });
});

describe('resolveInstallRequest', () => {
  it('wizard when interactive and no input', () => {
    expect(resolveInstallRequest([], {}, true).mode).toBe('wizard');
  });

  it('flags when non-interactive', () => {
    expect(resolveInstallRequest([], {}, false).mode).toBe('flags');
  });

  it('flags when flags are present', () => {
    expect(resolveInstallRequest([], { project: true }, true).mode).toBe('flags');
  });

  it('error mode for invalid input', () => {
    const r = resolveInstallRequest(['bogus-cli'], {}, false);
    expect(r.mode).toBe('error');
  });
});