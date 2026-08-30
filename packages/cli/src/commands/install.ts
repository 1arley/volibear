import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { CliOptions } from '../cli.js';
import { bundledPipelinesDir, bundledAgentsDir } from '../app.js';

/** Executors that can actually be resolved by the runtime. */
const KNOWN_EXECUTORS = ['mock', 'opencode', 'codex', 'claude'] as const;
const ALL_AGENTS = ['rubberduck', 'architect', 'developer', 'reviewer', 'fixer', 'verifier'] as const;

interface InstallSelection {
  scope: 'project' | 'global';
  executors: string[];
  agents: string[];
  router: '9router' | 'native';
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
  const scope: 'project' | 'global' =
    options.global ? 'global' : options.project ? 'project' : positional[0] === 'global' ? 'global' : 'project';

  let router: '9router' | 'native';
  if (options.router === undefined || options.router === 'native' || options.router === 'none') {
    router = 'native';
  } else if (options.router === '9router') {
    router = '9router';
  } else {
    console.error(`Unknown router "${options.router}" (available: native, 9router).`);
    return 1;
  }

  // Positional executors: `volibear install opencode codex`
  const positionals = positional.filter((p) => p !== 'global' && p !== 'project');
  const requested = positionals.length > 0
    ? positionals
    : options.executor
      ? [options.executor]
      : [];

  const unknown = requested.filter((e) => !KNOWN_EXECUTORS.includes(e as never));
  if (unknown.length > 0) {
    console.error(
      `Unknown executor(s): ${unknown.join(', ')}. Available: ${KNOWN_EXECUTORS.join(', ')}.`,
    );
    return 1;
  }

  // Default: use mock when no explicit executor is selected.
  // The user must opt into a real executor by name.
  const executors = requested.length > 0 ? requested : ['mock'];
  const agents = [...ALL_AGENTS];

  // The first selected executor is the default for all agents.
  const defaultExecutor = executors[0];

  const selection: InstallSelection = {
    scope,
    executors,
    agents,
    router,
    model: 'gpt-5.6-luna',
  };

  const targetDir = selection.scope === 'global'
    ? resolve(getGlobalDir(), '.volibear')
    : resolve(process.cwd(), '.volibear');

  mkdirSync(resolve(targetDir, 'agents'), { recursive: true });
  mkdirSync(resolve(targetDir, 'pipelines'), { recursive: true });
  mkdirSync(resolve(targetDir, '.runs'), { recursive: true });

  // Never clobber an existing config silently.
  const configFile = resolve(targetDir, 'config.yaml');
  let configAction: 'written' | 'kept';
  if (existsSync(configFile) && !options.force) {
    configAction = 'kept';
  } else {
    writeConfig(targetDir, selection, defaultExecutor);
    configAction = 'written';
  }

  // Keep run state out of git without touching the user's root .gitignore.
  const nestedIgnore = resolve(targetDir, '.gitignore');
  if (!existsSync(nestedIgnore)) {
    writeFileSync(nestedIgnore, '# Volibear runtime state\n.runs/\n', 'utf-8');
  }

  const copiedPipelines = await copyPipelines(targetDir);
  const copiedAgents = await copyAgents(targetDir);

  const scopeLabel = selection.scope === 'global' ? 'globally' : 'in this project';
  console.log(`Volibear installed ${scopeLabel}.`);
  console.log(`  config: ${configFile} (${configAction})`);
  console.log(`  executors: ${selection.executors.join(', ')}`);
  console.log(`  agents: ${selection.agents.join(', ')}`);
  console.log(`  router: ${selection.router}`);
  if (copiedPipelines.length > 0) {
    console.log(`  pipelines copied: ${copiedPipelines.join(', ')}`);
  }
  if (copiedAgents.length > 0) {
    console.log(`  agent instructions copied: ${copiedAgents.join(', ')}`);
  }
  if (configAction === 'kept') {
    console.log('  note: existing config.yaml was kept; use --force to overwrite.');
  }
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

  const content = `# Volibear ${selection.scope} configuration
version: 1
pipeline: feature
executor: ${defaultExecutor}
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
  writeFileSync(file, content, 'utf-8');
}

/** Copy bundled default pipelines into the target pipelines directory. */
async function copyPipelines(targetDir: string): Promise<string[]> {
  const bundled = bundledPipelinesDir();
  const target = resolve(targetDir, 'pipelines');
  mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  for (const name of ['feature', 'fix']) {
    const source = resolve(bundled, `${name}.yaml`);
    const dest = resolve(target, `${name}.yaml`);
    if (existsSync(source) && !existsSync(dest)) {
      writeFileSync(dest, readFileSync(source, 'utf-8'), 'utf-8');
      copied.push(`${name}.yaml`);
    }
  }
  return copied;
}

/** Copy bundled agent instruction files into the target agents directory. */
async function copyAgents(targetDir: string): Promise<string[]> {
  const bundled = bundledAgentsDir();
  const target = resolve(targetDir, 'agents');
  mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  for (const name of ALL_AGENTS) {
    const source = resolve(bundled, `${name}.md`);
    const dest = resolve(target, `${name}.md`);
    if (existsSync(source) && !existsSync(dest)) {
      writeFileSync(dest, readFileSync(source, 'utf-8'), 'utf-8');
      copied.push(`${name}.md`);
    }
  }
  return copied;
}
