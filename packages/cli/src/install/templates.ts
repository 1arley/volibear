import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundledInstallDir } from '../app.js';
import type { IntegrationId } from './types.js';

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
