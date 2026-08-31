import { describe, it, expect } from 'vitest';
import { createInstallPlan, defaultSelection, AGENT_INSTRUCTION_FILES } from './plan.js';
import type { InstallSelection, IntegrationId } from './types.js';

function fakeDeps(existingPaths: string[] = []) {
  return {
    exists: (p: string) => existingPaths.includes(p),
    readTemplate: (_id: IntegrationId) => '# volibear bridge agent template',
    readBundledPipeline: (name: string) => name === 'feature' || name === 'fix' ? `# ${name} pipeline` : undefined,
    readBundledAgent: (name: string) => `# ${name} instructions`,
  };
}

describe('createInstallPlan', () => {
  const context = { cwd: '/work/repo', homeDir: '/home/alice' };

  it('produces runtime files for project scope', () => {
    const sel: InstallSelection = {
      scope: 'project',
      integrations: [],
      pipelines: ['feature', 'fix'],
      executor: 'mock',
      router: 'native',
      force: false,
    };
    const plan = createInstallPlan(sel, context, fakeDeps());
    expect(plan.files.length).toBeGreaterThan(0);
    // config
    expect(plan.files.some((f) => f.kind === 'config' && f.path.endsWith('.volibear/config.yaml'))).toBe(true);
    // gitignore
    expect(plan.files.some((f) => f.kind === 'gitignore')).toBe(true);
    // pipelines
    expect(plan.files.filter((f) => f.kind === 'pipeline').length).toBe(2);
    // agent instructions
    expect(plan.files.filter((f) => f.kind === 'agent-instructions').length).toBe(AGENT_INSTRUCTION_FILES.length);
  });

  it('includes bridge agent files when integrations are selected', () => {
    const sel: InstallSelection = {
      scope: 'project',
      integrations: ['opencode'],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: false,
    };
    const plan = createInstallPlan(sel, context, fakeDeps());
    const bridges = plan.files.filter((f) => f.kind === 'integration-agent');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].path).toMatch(/\.opencode\/agents\/volibear\.md$/);
    expect(bridges[0].action).toBe('create');
  });

  it('marks existing bridge files as keep when force is false', () => {
    const opencodePath = '/work/repo/.opencode/agents/volibear.md';
    const sel: InstallSelection = {
      scope: 'project',
      integrations: ['opencode'],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: false,
    };
    const plan = createInstallPlan(sel, context, fakeDeps([opencodePath]));
    const bridge = plan.files.find((f) => f.kind === 'integration-agent')!;
    expect(bridge.action).toBe('keep');
    expect(bridge.content).toBeUndefined();
  });

  it('overwrites existing bridge files when force is true', () => {
    const opencodePath = '/work/repo/.opencode/agents/volibear.md';
    const sel: InstallSelection = {
      scope: 'project',
      integrations: ['opencode'],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: true,
    };
    const plan = createInstallPlan(sel, context, fakeDeps([opencodePath]));
    const bridge = plan.files.find((f) => f.kind === 'integration-agent')!;
    // Existing + force ⇒ 'overwrite' so the report can say "overwritten".
    expect(bridge.action).toBe('overwrite');
    expect(bridge.content).toBeDefined();
  });

  it('does not overwrite existing config without force', () => {
    const configPath = '/work/repo/.volibear/config.yaml';
    const sel: InstallSelection = defaultSelection();
    sel.scope = 'project';
    sel.force = false;
    const plan = createInstallPlan(sel, context, fakeDeps([configPath]));
    const config = plan.files.find((f) => f.kind === 'config')!;
    expect(config.action).toBe('keep');
  });

  it('overwrites existing config with force', () => {
    const configPath = '/work/repo/.volibear/config.yaml';
    const sel = defaultSelection();
    sel.force = true;
    const plan = createInstallPlan(sel, context, fakeDeps([configPath]));
    const config = plan.files.find((f) => f.kind === 'config')!;
    // Existing + force ⇒ 'overwrite' (LOW-6).
    expect(config.action).toBe('overwrite');
  });

  it('creates config with force when it does not exist', () => {
    const sel = defaultSelection();
    sel.force = true;
    const plan = createInstallPlan(sel, context, fakeDeps());
    const config = plan.files.find((f) => f.kind === 'config')!;
    expect(config.action).toBe('create');
  });

  it('both scope expands to project + global entries', () => {
    const sel: InstallSelection = {
      scope: 'both',
      integrations: ['codex'],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: false,
    };
    const plan = createInstallPlan(sel, context, fakeDeps());
    const bridges = plan.files.filter((f) => f.kind === 'integration-agent');
    expect(bridges).toHaveLength(2);
    expect(bridges[0].scope).toBe('project');
    expect(bridges[1].scope).toBe('global');
  });

  it('emits warning when no integrations are selected', () => {
    const sel = defaultSelection();
    const plan = createInstallPlan(sel, context, fakeDeps());
    expect(plan.warnings.some((w) => w.includes('no coding CLI integrations'))).toBe(true);
  });

  it('never includes agent files other than volibear.md/toml for integrations', () => {
    const sel: InstallSelection = {
      scope: 'project',
      integrations: ['opencode', 'claude', 'codex'],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: false,
    };
    const plan = createInstallPlan(sel, context, fakeDeps());
    const bridges = plan.files.filter((f) => f.kind === 'integration-agent');
    // Only the volibear bridge files
    for (const b of bridges) {
      expect(b.path).toMatch(/volibear\.(md|toml)$/);
    }
  });

  it('global scope uses home directory', () => {
    const sel: InstallSelection = {
      scope: 'global',
      integrations: ['claude'],
      pipelines: ['feature'],
      executor: 'mock',
      router: 'native',
      force: false,
    };
    const plan = createInstallPlan(sel, context, fakeDeps());
    const bridge = plan.files.find((f) => f.kind === 'integration-agent')!;
    expect(bridge.path).toMatch(/^\/home\/alice\//);
  });
});