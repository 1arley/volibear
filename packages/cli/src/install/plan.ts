import { resolve } from 'node:path';
import type {
  PlannedFile,
  InstallSelection,
  InstallPlan,
} from './types.js';
import type { InstallPathContext } from './paths.js';
import { volibearTargetDir, integrationAgentPath } from './paths.js';
import { renderOpenCodeRoleAgent, type OpenCodeRole } from './templates.js';

/** All Volibear role instruction files installed into .volibear/agents/. */
export const AGENT_INSTRUCTION_FILES = [
  'rubberduck.md',
  'architect.md',
  'developer.md',
  'reviewer.md',
  'fixer.md',
  'verifier.md',
] as const;

export type { InstallPlan, InstallSelection, PlannedFile };

export interface InstallPlanDependencies {
  exists(path: string): boolean;
  readTemplate(integration: import('./types.js').IntegrationId): string;
  readBundledPipeline(name: string): string | undefined;
  readBundledAgent(name: string): string | undefined;
}

const DEFAULT_PIPELINES = ['feature', 'fix'] as const;
const DEFAULT_EXECUTOR = 'mock';
const DEFAULT_ROUTER = 'native';

export function defaultSelection(): InstallSelection {
  return {
    scope: 'project',
    integrations: [],
    pipelines: [...DEFAULT_PIPELINES],
    executor: DEFAULT_EXECUTOR,
    router: DEFAULT_ROUTER,
    force: false,
  };
}

export function scopeFromSelection(selection: InstallSelection): ('project' | 'global')[] {
  switch (selection.scope) {
    case 'project':
      return ['project'];
    case 'global':
      return ['global'];
    case 'both':
      return ['project', 'global'];
  }
}

/**
 * Expand a selection into a deterministic write plan. Pure: no filesystem
 * writes happen here; `exists` is injected for testability.
 */
export function createInstallPlan(
  selection: InstallSelection,
  context: InstallPathContext,
  deps: InstallPlanDependencies,
): InstallPlan {
  const files: PlannedFile[] = [];
  const warnings: string[] = [];

  const targets = scopeFromSelection(selection);

  for (const scope of targets) {
    const volibearDir = volibearTargetDir(scope, context);

    // config.yaml — the source of truth for pipeline/executor/router.
    const configPath = resolve(volibearDir, 'config.yaml');
    const configExists = deps.exists(configPath);
    // 'overwrite' (not 'create') when the file exists and will be replaced,
    // so the applied-file report can distinguish the two outcomes (LOW-6).
    const configAction = configExists ? (selection.force ? 'overwrite' : 'keep') : 'create';
    files.push({
      kind: 'config',
      path: configPath,
      action: configAction,
      content: configContent(selection, scope),
      scope,
    });

    // .gitignore for .runs/ — only if missing.
    const gitignorePath = resolve(volibearDir, '.gitignore');
    if (!deps.exists(gitignorePath)) {
      files.push({
        kind: 'gitignore',
        path: gitignorePath,
        action: 'create',
        content: '# Volibear runtime state\n.runs/\n',
        scope,
      });
    }

    // pipelines selected by the user.
    for (const name of selection.pipelines) {
      const path = resolve(volibearDir, 'pipelines', `${name}.yaml`);
      if (!deps.exists(path)) {
        const content = deps.readBundledPipeline(name);
        if (content === undefined) {
          warnings.push(`pipeline "${name}" not found in bundled resources; skipped`);
          continue;
        }
        files.push({ kind: 'pipeline', path, action: 'create', content, scope });
      }
    }

    // agent instruction files.
    for (const name of AGENT_INSTRUCTION_FILES) {
      const path = resolve(volibearDir, 'agents', name);
      if (!deps.exists(path)) {
        const content = deps.readBundledAgent(name);
        if (content === undefined) {
          warnings.push(`agent instructions "${name}" not found in bundled resources; skipped`);
          continue;
        }
        files.push({ kind: 'agent-instructions', path, action: 'create', content, scope });
      }
    }

    // native CLI bridge agents — only the volibear file is ever touched.
    for (const integration of selection.integrations) {
      const path = integrationAgentPath(integration, scope, context);
      const exists = deps.exists(path);
      // 'overwrite' when the bridge exists and will be replaced (LOW-6).
      const action = exists ? (selection.force ? 'overwrite' : 'keep') : 'create';
      files.push({
        kind: 'integration-agent',
        path,
        action,
        content: exists && !selection.force
          ? undefined
          : deps.readTemplate(integration),
        integration,
        scope,
      });

      if (integration === 'opencode') {
        const agentDir = resolve(path, '..');
        for (const instructionFile of AGENT_INSTRUCTION_FILES) {
          const role = instructionFile.replace(/\.md$/, '') as OpenCodeRole;
          const agentPath = resolve(agentDir, `volibear-${role}.md`);
          const agentExists = deps.exists(agentPath);
          const action = agentExists ? (selection.force ? 'overwrite' : 'keep') : 'create';
          const body = deps.readBundledAgent(instructionFile);
          if (body === undefined) {
            warnings.push(`agent instructions "${instructionFile}" not found in bundled resources; skipped`);
            continue;
          }
          files.push({
            kind: 'integration-agent',
            path: agentPath,
            action,
            content: action === 'keep' ? undefined : renderOpenCodeRoleAgent(role, body),
            integration,
            scope,
          });
        }
      }
    }
  }

  if (selection.integrations.length === 0) {
    warnings.push(
      'no coding CLI integrations were selected; only .volibear runtime files were installed',
    );
  }

  return { selection, files, warnings };
}

/** Serialize the config.yaml content for a scope and selection. */
export function configContent(selection: InstallSelection, scope: 'project' | 'global'): string {
  const agentLines = AGENT_INSTRUCTION_FILES.map((f) => {
    const id = f.replace(/\.md$/, '');
    return `  ${id}:\n    executor: ${selection.executor}`;
  }).join('\n');

  const pipeline = selection.pipelines[0] ?? 'feature';

  return `# Volibear ${scope} configuration
version: 1
pipeline: ${pipeline}
executor: ${selection.executor}
router:
  mode: ${selection.router}
agents:
${agentLines}
verification:
  # Add the deterministic project checks that gate a PASS, e.g.:
  # commands:
  #   - npm test
  #   - npm run typecheck
  commands: []
repair:
  max_cycles: 3
  reject_on: [critical, high]
`;
}
