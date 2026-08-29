import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { CliOptions } from '../cli.js';
import { bundledPipelinesDir } from '../app.js';

const ALL_EXECUTORS = ['opencode', 'codex', 'claude', 'gemini', 'aider'] as const;
const ALL_AGENTS = ['rubberduck', 'architect', 'developer', 'reviewer', 'fixer', 'verifier'] as const;

interface InstallSelection {
  scope: 'project' | 'global';
  executors: string[];
  agents: string[];
  router: '9router' | 'native' | 'none';
  model: string;
}

/**
 * volibear install [scope] [executors...]
 *
 * Non-interactive forms:
 *   volibear install --project
 *   volibear install --global
 *   volibear install --project opencode codex
 *   volibear install --global opencode claude codex
 *   volibear install --project opencode --router 9router
 */
export async function runInstall(
  positional: string[],
  options: CliOptions,
): Promise<number> {
  const selection: InstallSelection = {
    scope: options.global ? 'global' : options.project ? 'project' : positional[0] === 'global' ? 'global' : 'project',
    executors: options.executor ? [options.executor] : [],
    agents: [],
    router: options.router === '9router' ? '9router' : options.router === 'native' ? 'native' : 'native',
    model: 'gpt-5.6-luna',
  };

  // Positional executors: `volibear install opencode codex`
  const positionals = positional.filter((p) => p !== 'global' && p !== 'project');
  if (positionals.length > 0) {
    selection.executors = positionals.filter((e) => ALL_EXECUTORS.includes(e as never));
  }

  // Default: if no executors selected, use all available.
  if (selection.executors.length === 0) {
    selection.executors = [...ALL_EXECUTORS];
  }
  selection.agents = [...ALL_AGENTS];

  // Determine the default executor for agents.
  const defaultExecutor = selection.executors[0] === 'opencode'
    ? 'opencode'
    : selection.executors[0] === 'codex'
      ? 'codex'
      : selection.executors[0] === 'claude'
        ? 'claude'
        : 'mock';

  const targetDir = selection.scope === 'global'
    ? resolve(getGlobalDir(), '.volibear')
    : resolve(process.cwd(), '.volibear');

  mkdirSync(resolve(targetDir, 'agents'), { recursive: true });
  mkdirSync(resolve(targetDir, 'pipelines'), { recursive: true });
  mkdirSync(resolve(targetDir, '.runs'), { recursive: true });

  writeConfig(targetDir, selection, defaultExecutor);
  await copyPipelines(targetDir);

  const scopeLabel = selection.scope === 'global' ? 'globally' : 'in this project';
  console.log(`Volibear installed ${scopeLabel}.`);
  console.log(`  config: ${resolve(targetDir, 'config.yaml')}`);
  console.log(`  executors: ${selection.executors.join(', ')}`);
  console.log(`  agents: ${selection.agents.join(', ')}`);
  console.log(`  router: ${selection.router}`);
  return 0;
}

function getGlobalDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '~';
}

function writeConfig(
  dir: string,
  selection: InstallSelection,
  defaultExecutor: string,
): void {
  const file = resolve(dir, 'config.yaml');
  const agentLines = selection.agents.map((agent) => {
    const model = agent === 'architect' ? 'gpt-5.6-terra'
      : agent === 'reviewer' ? 'glm-5.2'
        : agent === 'developer' || agent === 'fixer' ? 'deepseek-v4-flash'
          : 'gpt-5.6-luna';
    return `  ${agent}:\n    executor: ${defaultExecutor}\n    model: ${model}`;
  }).join('\n');

  const routerMode = selection.router === 'none' ? 'native' : selection.router;
  const content = `# Volibear ${selection.scope} configuration
version: 1
pipeline: feature
executor: ${defaultExecutor}
router:
  mode: ${routerMode}
agents:
${agentLines}
verification:
  commands:
    - echo ok
repair:
  max_cycles: 3
  reject_on: [critical, high]
`;
  writeFileSync(file, content, 'utf-8');
}

/** Copy bundled default pipelines into the target pipelines directory. */
async function copyPipelines(targetDir: string): Promise<void> {
  const bundled = bundledPipelinesDir();
  const target = resolve(targetDir, 'pipelines');
  mkdirSync(target, { recursive: true });
  for (const name of ['feature', 'fix']) {
    const source = resolve(bundled, `${name}.yaml`);
    const dest = resolve(target, `${name}.yaml`);
    if (existsSync(source) && !existsSync(dest)) {
      writeFileSync(dest, readFileSync(source, 'utf-8'), 'utf-8');
    }
  }
}

