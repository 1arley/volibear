import { describe, it, expect } from 'vitest';
import {
  volibearTargetDir,
  integrationAgentPath,
  integrationAgentPaths,
  displayPath,
} from './paths.js';

const context = { cwd: '/work/repo', homeDir: '/home/alice' };

describe('volibearTargetDir', () => {
  it('resolves project runtime dir', () => {
    expect(volibearTargetDir('project', context)).toBe('/work/repo/.volibear');
  });

  it('resolves global runtime dir under home', () => {
    expect(volibearTargetDir('global', context)).toBe('/home/alice/.volibear');
  });
});

describe('integrationAgentPaths', () => {
  it('returns bridge plus six role agents for OpenCode', () => {
    const paths = integrationAgentPaths('opencode', 'project', context);
    expect(paths).toHaveLength(7);
    expect(paths[0]).toBe('/work/repo/.opencode/agents/volibear.md');
    expect(paths).toContain('/work/repo/.opencode/agents/volibear-developer.md');
  });
});

describe('integrationAgentPath', () => {
  it('OpenCode project/global', () => {
    expect(integrationAgentPath('opencode', 'project', context)).toBe(
      '/work/repo/.opencode/agents/volibear.md',
    );
    expect(integrationAgentPath('opencode', 'global', context)).toBe(
      '/home/alice/.config/opencode/agents/volibear.md',
    );
  });

  it('Claude project/global', () => {
    expect(integrationAgentPath('claude', 'project', context)).toBe(
      '/work/repo/.claude/agents/volibear.md',
    );
    expect(integrationAgentPath('claude', 'global', context)).toBe(
      '/home/alice/.claude/agents/volibear.md',
    );
  });

  it('Codex project/global (TOML)', () => {
    expect(integrationAgentPath('codex', 'project', context)).toBe(
      '/work/repo/.codex/agents/volibear.toml',
    );
    expect(integrationAgentPath('codex', 'global', context)).toBe(
      '/home/alice/.codex/agents/volibear.toml',
    );
  });
});

describe('displayPath', () => {
  it('rewrites home prefix to ~', () => {
    expect(displayPath('/home/alice/.claude/agents/volibear.md', '/home/alice')).toBe(
      '~/.claude/agents/volibear.md',
    );
  });

  it('leaves other paths untouched', () => {
    expect(displayPath('/work/repo/.volibear/config.yaml', '/home/alice')).toBe(
      '/work/repo/.volibear/config.yaml',
    );
  });
});
