import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  resolveProjectDir,
  ensureConfigDirs,
  EventLog,
  ArtifactStore,
  RunStore,
} from '@volibear/core';
import {
  AgentDefinition,
  BUILTIN_AGENTS,
  Pipeline,
  ProjectConfig,
  RubberduckInteraction,
} from '@volibear/contracts';
import { PipelineParser, validatePipelineAgents, RunOrchestrator } from '@volibear/runtime';
import { ExecutorRegistry, MockExecutor, MockRubberduckDriver } from '@volibear/executors';
import { CliOptions } from './cli.js';

/**
 * Resolve the CLI's bundled pipelines directory (resources/pipelines).
 * Uses import.meta.url so it works regardless of the process cwd.
 */
export function bundledPipelinesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  // dist/app.js (or src/app.ts under vitest) — the package root is one level up
  const packageDir = dirname(dirname(currentFile));
  return join(packageDir, 'resources', 'pipelines');
}

/**
 * Application wiring for CLI commands.
 * Resolves config, stores, agents, executors, and the pipeline.
 */
export class App {
  readonly cwd: string;
  readonly projectDir: string;
  readonly runsDir: string;
  readonly config: ProjectConfig;
  readonly runStore: RunStore;
  readonly executors: ExecutorRegistry;
  readonly parser: PipelineParser;

  private constructor(cwd: string, config: ProjectConfig, runsDir: string) {
    this.cwd = cwd;
    this.projectDir = resolveProjectDir(cwd);
    this.runsDir = runsDir;
    this.config = config;
    this.runStore = new RunStore(runsDir);
    this.executors = new ExecutorRegistry();
    this.parser = new PipelineParser();
  }

  static async create(cwd = process.cwd(), options: CliOptions = {}): Promise<App> {
    const { projectDir } = ensureConfigDirs(cwd);
    const overrides: Partial<ProjectConfig> = {};
    if (options.executor) overrides.executor = options.executor;
    if (options.pipeline) overrides.pipeline = options.pipeline;
    if (options.router) overrides.router = { mode: '9router' };
    const config = await loadConfig({ projectDir, overrides });
    const runsDir = resolve(projectDir, '.runs');
    return new App(cwd, config, runsDir);
  }

  /**
   * Resolve agent definitions, merging config overrides onto built-ins.
   */
  getAgents(): Map<string, AgentDefinition> {
    const map = new Map<string, AgentDefinition>();
    for (const agent of BUILTIN_AGENTS) {
      const override = this.config.agents[agent.id];
      map.set(agent.id, {
        ...agent,
        executor: override?.executor ?? agent.executor,
        router: override?.router ?? agent.router,
        model: override?.model ?? agent.model,
      });
    }
    return map;
  }

  /**
   * Resolve executor map from config (mock only for now; real executors register later).
   */
  getExecutors() {
    const map = new Map<string, import('@volibear/contracts').Executor>();
    const configuredExecutor = this.config.executor;
    if (configuredExecutor === 'mock' || !this.executors.has(configuredExecutor)) {
      map.set('mock', this.executors.get('mock')!);
    }
    return map;
  }

  /**
   * Load the pipeline for this run.
   */
  async getPipeline(name?: string): Promise<Pipeline> {
    const pipelineName = name ?? this.config.pipeline;
    const pipelinesDir = resolve(this.projectDir, 'pipelines');
    const pipeline = await this.parser.loadFromDir(pipelineName, pipelinesDir);
    if (!pipeline) {
      // Fall back to bundled default pipelines shipped with the CLI.
      const bundled = bundledPipelinesDir();
      const fromBundled = await this.parser.loadFromDir(pipelineName, bundled);
      if (fromBundled) return fromBundled;
      throw new Error(
        `pipeline "${pipelineName}" not found in ${pipelinesDir} or ${bundled}`,
      );
    }

    const problems = validatePipelineAgents(pipeline, [...this.getAgents().values()]);
    if (problems.length > 0) {
      throw new Error(`pipeline validation failed:\n  ${problems.join('\n  ')}`);
    }
    return pipeline;
  }

  /**
   * Create an orchestrator for a run.
   */
  createOrchestrator(
    runId: string,
    options: {
      onStage?: (stageId: string, run: import('@volibear/contracts').Run) => void;
      rubberduckInteraction?: RubberduckInteraction;
      findings?: unknown;
    } = {},
  ) {
    const runDir = this.runStore.runDir(runId);
    const events = new EventLog(runDir);
    const artifacts = new ArtifactStore(runDir);
    return new RunOrchestrator({
      runStore: this.runStore,
      events,
      artifacts,
      cwd: this.cwd,
      agents: this.getAgents(),
      executors: this.getExecutors(),
      config: {
        repair: this.config.repair,
        verification: this.config.verification,
      },
      rubberduck: new MockRubberduckDriver(),
      rubberduckInteraction: options.rubberduckInteraction,
      findings: options.findings,
      onStage: options.onStage,
    });
  }
}
