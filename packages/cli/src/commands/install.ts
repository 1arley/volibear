import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { CliOptions } from '../cli.js';
import { bundledPipelinesDir } from '../app.js';
import { PipelineParser } from '@volibear/runtime';

/**
 * volibear install — scaffold .volibear/ config in the project or global scope.
 */
export async function runInstall(positional: string[], options: CliOptions): Promise<number> {
  const scope = options.global ? 'global' : options.project ? 'project' : positional[0] === 'global' ? 'global' : 'project';

  if (scope === 'global') {
    const globalDir = resolve(process.env.HOME || '~', '.volibear');
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(resolve(globalDir, 'agents'), { recursive: true });
    mkdirSync(resolve(globalDir, 'pipelines'), { recursive: true });
    writeGlobalConfig(globalDir);
    console.log('Volibear installed globally.');
    console.log(`  config: ${resolve(globalDir, 'config.yaml')}`);
    return 0;
  }

  const projectDir = resolve(process.cwd(), '.volibear');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(resolve(projectDir, 'agents'), { recursive: true });
  mkdirSync(resolve(projectDir, 'pipelines'), { recursive: true });
  mkdirSync(resolve(projectDir, '.runs'), { recursive: true });
  writeProjectConfig(projectDir, options);
  await copyPipelines(resolve(projectDir, 'pipelines'));

  console.log('Volibear installed in this project.');
  console.log(`  config: ${resolve(projectDir, 'config.yaml')}`);
  return 0;
}

/** Copy bundled default pipelines into the target pipelines directory. */
async function copyPipelines(targetDir: string): Promise<void> {
  const bundled = bundledPipelinesDir();
  const parser = new PipelineParser();
  for (const name of ['feature', 'fix']) {
    const pipeline = await parser.loadFromDir(name, bundled);
    if (!pipeline) continue;
    const dest = resolve(targetDir, `${name}.yaml`);
    if (existsSync(dest)) continue; // don't overwrite user pipelines
    writeFileSync(
      dest,
      serializeYaml(pipeline),
      'utf-8',
    );
  }
}

/** Minimal YAML serializer for pipeline objects (plain subset used by the runtime). */
function serializeYaml(pipeline: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`name: ${pipeline.name}`);
  lines.push(`description: ${JSON.stringify(pipeline.description ?? '')}`);
  lines.push(`version: ${pipeline.version}`);
  lines.push('');
  const repair = pipeline.repair as { max_cycles: number; reject_on: string[] };
  lines.push('repair:');
  lines.push(`  max_cycles: ${repair.max_cycles}`);
  lines.push(`  reject_on: [${repair.reject_on.join(', ')}]`);
  lines.push('');
  lines.push('stages:');
  for (const stage of pipeline.stages as Array<Record<string, unknown>>) {
    lines.push(`  - id: ${stage.id}`);
    lines.push(`    type: ${stage.type}`);
    if (stage.description) lines.push(`    description: ${JSON.stringify(stage.description)}`);
    if (stage.agent) lines.push(`    agent: ${stage.agent}`);
    if (stage.gate) lines.push(`    gate: ${stage.gate}`);
    if (stage.max_cycles) lines.push(`    max_cycles: ${stage.max_cycles}`);
    if (stage.fixer_agent) lines.push(`    fixer_agent: ${stage.fixer_agent}`);
    if (stage.stages) {
      lines.push('    stages:');
      for (const inner of stage.stages as Array<Record<string, unknown>>) {
        lines.push(`      - id: ${inner.id}`);
        lines.push(`        type: ${inner.type}`);
        if (inner.agent) lines.push(`        agent: ${inner.agent}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

function writeGlobalConfig(dir: string): void {
  const file = resolve(dir, 'config.yaml');
  const content = `# Volibear global configuration
version: 1
pipeline: feature
executor: mock
router:
  mode: native
agents:
  rubberduck:
    executor: mock
    model: gpt-5.6-luna
  architect:
    executor: mock
    model: gpt-5.6-terra
  developer:
    executor: mock
    model: deepseek-v4-flash
  reviewer:
    executor: mock
    model: glm-5.2
  fixer:
    executor: mock
    model: deepseek-v4-flash
  verifier:
    executor: mock
verification:
  commands:
    - echo ok
repair:
  max_cycles: 3
  reject_on: [critical, high]
`;
  writeFileSync(file, content, 'utf-8');
}

function writeProjectConfig(dir: string, options: CliOptions): void {
  const file = resolve(dir, 'config.yaml');
  const content = `# Volibear project configuration
version: 1
pipeline: feature
executor: mock
router:
  mode: native
agents:
  rubberduck:
    executor: mock
  architect:
    executor: mock
  developer:
    executor: mock
  reviewer:
    executor: mock
  fixer:
    executor: mock
  verifier:
    executor: mock
verification:
  commands:
    - echo ok
repair:
  max_cycles: 3
  reject_on: [critical, high]
`;
  writeFileSync(file, content, 'utf-8');
}
