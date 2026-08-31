import type { IntegrationId } from '../types.js';

export interface IntegrationDefinition {
  id: IntegrationId;
  label: string;
  command: string;
  /** File name inside resources/install/ (e.g. "opencode.md"). */
  templateFile: string;
  projectAgentPath(cwd: string): string;
  globalAgentPath(homeDir: string): string;
}

export const INTEGRATION_DEFS: Record<IntegrationId, IntegrationDefinition> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    templateFile: 'opencode.md',
    projectAgentPath: (cwd) => `${cwd}/.opencode/agents/volibear.md`,
    globalAgentPath: (home) => `${home}/.config/opencode/agents/volibear.md`,
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    templateFile: 'claude.md',
    projectAgentPath: (cwd) => `${cwd}/.claude/agents/volibear.md`,
    globalAgentPath: (home) => `${home}/.claude/agents/volibear.md`,
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    templateFile: 'codex.toml',
    projectAgentPath: (cwd) => `${cwd}/.codex/agents/volibear.toml`,
    globalAgentPath: (home) => `${home}/.codex/agents/volibear.toml`,
  },
};

export function getIntegration(id: IntegrationId): IntegrationDefinition {
  const def = INTEGRATION_DEFS[id];
  if (!def) throw new Error(`Unknown integration: ${id}`);
  return def;
}