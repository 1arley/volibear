import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundledInstallDir } from '../app.js';
import type { IntegrationId } from './types.js';

export const OPENCODE_ROLE_METADATA = {
  rubberduck: { description: 'Clarifies intent and produces locked requirements', edit: 'deny', bash: 'deny', model: '9router/rubberduck' },
  architect: { description: 'Designs an implementation from locked requirements', edit: 'deny', bash: 'deny', model: '9router/architect' },
  developer: { description: 'Implements the approved Volibear architecture', edit: 'allow', bash: 'allow', model: '9router/build' },
  reviewer: { description: 'Reviews implementation and returns structured findings', edit: 'deny', bash: 'deny', model: '9router/reviewer' },
  fixer: { description: 'Fixes rejected review findings without redesigning', edit: 'allow', bash: 'allow', model: '9router/build' },
  verifier: { description: 'Synthesizes deterministic verification results', edit: 'deny', bash: 'allow', model: '9router/verifier' },
} as const;

export type OpenCodeRole = keyof typeof OPENCODE_ROLE_METADATA;

const TEMPLATE_FILES: Record<IntegrationId, string> = {
  opencode: 'opencode.md',
  claude: 'claude.md',
  codex: 'codex.toml',
};

/** Load a bundled integration template by integration id. */
export function readIntegrationTemplate(integration: IntegrationId): string {
  const file = resolve(bundledInstallDir(), TEMPLATE_FILES[integration]);
  return readFileSync(file, 'utf-8');
}

/** Render an OpenCode role agent from the canonical Volibear instruction body. */
export function renderOpenCodeRoleAgent(role: OpenCodeRole, body: string): string {
  const meta = OPENCODE_ROLE_METADATA[role];
  return `---\ndescription: ${meta.description}\nmode: subagent\nmodel: ${meta.model}\npermission:\n  edit: ${meta.edit}\n  bash: ${meta.bash}\n  task: deny\n---\n\n${body.trim()}\n`;
}
