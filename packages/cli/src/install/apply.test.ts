import { describe, it, expect } from 'vitest';
import { applyInstallPlan, type InstallFileSystem } from './apply.js';
import type { InstallPlan, PlannedFile } from './types.js';

/**
 * In-memory filesystem fake. `failWrite`/`failMkdir` let a test make the
 * first I/O call for a given path throw, simulating disk/permission errors.
 */
function fakeFs(opts: { failWrite?: string; failMkdir?: string } = {}) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const fs: InstallFileSystem = {
    exists: (p) => files.has(p),
    mkdir: (p) => {
      if (opts.failMkdir === p) throw new Error(`EACCES: permission denied, mkdir '${p}'`);
      dirs.add(p);
    },
    write: (p, c) => {
      if (opts.failWrite === p) throw new Error(`ENOSPC: no space left on device, write '${p}'`);
      files.set(p, c);
    },
    dirname: (p) => p.slice(0, p.lastIndexOf('/')) || '/',
  };
  return { fs, files, dirs };
}

function plan(files: PlannedFile[]): InstallPlan {
  return {
    selection: {
      scope: 'project',
      integrations: [],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: false,
    },
    files,
    warnings: [],
  };
}

describe('applyInstallPlan', () => {
  it('does not write files marked keep', () => {
    const { fs, files } = fakeFs();
    const result = applyInstallPlan(
      plan([{ kind: 'config', path: '/work/repo/.volibear/config.yaml', action: 'keep', content: 'x', scope: 'project' }]),
      fs,
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0].outcome).toBe('kept');
    expect(files.size).toBe(0);
  });

  it('writes created files and ensures the parent directory exists', () => {
    const { fs, files, dirs } = fakeFs();
    const result = applyInstallPlan(
      plan([{ kind: 'pipeline', path: '/work/repo/.volibear/pipelines/feature.yaml', action: 'create', content: 'p', scope: 'project' }]),
      fs,
    );
    expect(result.files[0].outcome).toBe('written');
    expect(files.get('/work/repo/.volibear/pipelines/feature.yaml')).toBe('p');
    expect(dirs.has('/work/repo/.volibear/pipelines')).toBe(true);
  });

  it('writes overwrite files and reports them as overwritten', () => {
    const { fs, files } = fakeFs();
    const result = applyInstallPlan(
      plan([{ kind: 'integration-agent', path: '/work/repo/.opencode/agents/volibear.md', action: 'overwrite', content: 'new', integration: 'opencode', scope: 'project' }]),
      fs,
    );
    expect(result.files[0].outcome).toBe('overwritten');
    expect(files.get('/work/repo/.opencode/agents/volibear.md')).toBe('new');
  });

  it('records a failed outcome and stops when write throws (MED-4)', () => {
    const { fs, files } = fakeFs({ failWrite: '/work/repo/.volibear/config.yaml' });
    const result = applyInstallPlan(
      plan([
        { kind: 'config', path: '/work/repo/.volibear/config.yaml', action: 'create', content: 'c', scope: 'project' },
        { kind: 'gitignore', path: '/work/repo/.volibear/.gitignore', action: 'create', content: 'g', scope: 'project' },
      ]),
      fs,
    );
    // The failing file is reported, and the plan stops before the next file.
    expect(result.files).toHaveLength(1);
    expect(result.files[0].outcome).toBe('failed');
    expect(result.files[0].error).toMatch(/ENOSPC/);
    expect(result.files[0].file.path).toBe('/work/repo/.volibear/config.yaml');
    // Nothing was written for the failing file, and the following file was
    // NOT attempted (the install aborted at the first failure).
    expect(files.has('/work/repo/.volibear/config.yaml')).toBe(false);
    expect(files.has('/work/repo/.volibear/.gitignore')).toBe(false);
  });

  it('records a failed outcome when mkdir throws (MED-4)', () => {
    const { fs } = fakeFs({ failMkdir: '/work/repo/.volibear' });
    const result = applyInstallPlan(
      plan([{ kind: 'config', path: '/work/repo/.volibear/config.yaml', action: 'create', content: 'c', scope: 'project' }]),
      fs,
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0].outcome).toBe('failed');
    expect(result.files[0].error).toMatch(/EACCES/);
  });

  it('applies earlier files before a later failure so the report is contextual', () => {
    const { fs, files } = fakeFs({ failWrite: '/work/repo/.volibear/pipelines/fix.yaml' });
    const result = applyInstallPlan(
      plan([
        { kind: 'config', path: '/work/repo/.volibear/config.yaml', action: 'create', content: 'c', scope: 'project' },
        { kind: 'pipeline', path: '/work/repo/.volibear/pipelines/fix.yaml', action: 'create', content: 'f', scope: 'project' },
        { kind: 'gitignore', path: '/work/repo/.volibear/.gitignore', action: 'create', content: 'g', scope: 'project' },
      ]),
      fs,
    );
    expect(result.files.map((f) => f.outcome)).toEqual(['written', 'failed']);
    expect(files.get('/work/repo/.volibear/config.yaml')).toBe('c');
    // The third file was never attempted.
    expect(files.has('/work/repo/.volibear/.gitignore')).toBe(false);
  });

  it('skips files without content', () => {
    const { fs } = fakeFs();
    const result = applyInstallPlan(
      plan([{ kind: 'integration-agent', path: '/work/repo/.claude/agents/volibear.md', action: 'create', scope: 'project' }]),
      fs,
    );
    expect(result.files[0].outcome).toBe('skipped');
  });

  it('copies plan warnings into the result', () => {
    const { fs } = fakeFs();
    const p = plan([]);
    p.warnings.push('note');
    const result = applyInstallPlan(p, fs);
    expect(result.warnings).toEqual(['note']);
  });
});
