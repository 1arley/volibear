import { resolve } from 'node:path';
import type { IntegrationId, InstallScope } from './types.js';

export interface InstallPathContext {
  cwd: string;
  homeDir: string;
}

/**
 * Resolve the user home directory. Uses HOME then USERPROFILE; does not fall
 * back to a literal '~' (which would resolve relative to the process cwd).
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE;
  if (!home) {
    throw new Error(
      'Cannot determine home directory for global installation (HOME/USERPROFILE is not set).',
    );
  }
  return home;
}

export function volibearTargetDir(
  scope: 'project' | 'global',
  context: InstallPathContext,
): string {
  return scope === 'project'
    ? resolve(context.cwd, '.volibear')
    : resolve(context.homeDir, '.volibear');
}

/** Canonical native agent path for a coding CLI integration. */
export function integrationAgentPath(
  integration: IntegrationId,
  scope: 'project' | 'global',
  context: InstallPathContext,
): string {
  switch (integration) {
    case 'opencode':
      return scope === 'project'
        ? resolve(context.cwd, '.opencode', 'agents', 'volibear.md')
        : resolve(context.homeDir, '.config', 'opencode', 'agents', 'volibear.md');
    case 'claude':
      return scope === 'project'
        ? resolve(context.cwd, '.claude', 'agents', 'volibear.md')
        : resolve(context.homeDir, '.claude', 'agents', 'volibear.md');
    case 'codex':
      return scope === 'project'
        ? resolve(context.cwd, '.codex', 'agents', 'volibear.toml')
        : resolve(context.homeDir, '.codex', 'agents', 'volibear.toml');
  }
}

/** All native files installed for an integration (bridge plus role agents). */
export function integrationAgentPaths(
  integration: IntegrationId,
  scope: 'project' | 'global',
  context: InstallPathContext,
): string[] {
  const bridge = integrationAgentPath(integration, scope, context);
  if (integration !== 'opencode') return [bridge];
  const dir = resolve(bridge, '..');
  return [
    bridge,
    ...['rubberduck', 'architect', 'developer', 'reviewer', 'fixer', 'verifier']
      .map((role) => resolve(dir, `volibear-${role}.md`)),
  ];
}

/** Short human-readable label for a path, replacing home with ~. */
export function displayPath(path: string, homeDir: string): string {
  if (path === homeDir) return '~';
  if (path.startsWith(homeDir + '/')) return `~${path.slice(homeDir.length)}`;
  return path;
}

export interface ExistingPathsResult {
  configs: string[];
  bridges: string[];
}

/**
 * Compute the install paths that already exist for a given scope + integration
 * selection. Used by the wizard so overwrite prompts only cover files that the
 * current selection would actually touch (never prompt for a global config
 * when only project scope was chosen, or for a bridge whose CLI was not
 * selected). Pure: `exists` is injected for testability.
 */
export function computeExistingPaths(
  scope: InstallScope,
  integrations: readonly IntegrationId[],
  context: InstallPathContext,
  exists: (path: string) => boolean,
): ExistingPathsResult {
  const scopes: ('project' | 'global')[] =
    scope === 'both' ? ['project', 'global'] : [scope];
  const configs: string[] = [];
  const bridges: string[] = [];

  for (const s of scopes) {
    // Without a home directory there is no global target to prompt about.
    if (s === 'global' && !context.homeDir) continue;

    const configPath = resolve(volibearTargetDir(s, context), 'config.yaml');
    if (exists(configPath)) configs.push(configPath);

    for (const id of integrations) {
      for (const path of integrationAgentPaths(id, s, context)) {
        if (exists(path)) bridges.push(path);
      }
    }
  }

  return { configs, bridges };
}
