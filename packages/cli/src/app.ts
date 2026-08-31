import { resolve, dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  resolveProjectDir,
  resolveGlobalDir,
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
  RubberduckDriver,
  RubberduckInteraction,
} from '@volibear/contracts';
import { PipelineParser, validatePipelineAgents, RunOrchestrator } from '@volibear/runtime';
import { ExecutorRegistry, MockRubberduckDriver, CliRubberduckDriver } from '@volibear/executors';
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

/** Resolve the CLI's bundled agent instructions directory (resources/agents). */
export function bundledAgentsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageDir = dirname(dirname(currentFile));
  return join(packageDir, 'resources', 'agents');
}

/**
 * Resolve the CLI's bundled coding-CLI integration templates
 * (resources/install — opencode.md, claude.md, codex.toml).
 */
export function bundledInstallDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageDir = dirname(dirname(currentFile));
  return join(packageDir, 'resources', 'install');
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
  /** CLI flags must beat per-agent config entries (plan § 20 precedence). */
  private readonly cliExecutor?: string;
  private readonly cliRouter?: string;
  configSource: 'project' | 'global' | 'defaults' = 'defaults';

  private constructor(
    cwd: string,
    config: ProjectConfig,
    runsDir: string,
    cliExecutor?: string,
    cliRouter?: string,
  ) {
    this.cwd = cwd;
    this.projectDir = resolveProjectDir(cwd);
    this.runsDir = runsDir;
    this.config = config;
    this.runStore = new RunStore(runsDir);
    this.executors = new ExecutorRegistry(config.executor_timeout_ms);
    this.parser = new PipelineParser();
    this.cliExecutor = cliExecutor;
    this.cliRouter = cliRouter;
  }

  static async create(
    cwd = process.cwd(),
    options: CliOptions = {},
  ): Promise<App & { configSource: 'project' | 'global' | 'defaults' }> {
    const { projectDir } = ensureConfigDirs(cwd);
    const overrides: Partial<ProjectConfig> = {};
    if (options.executor) overrides.executor = options.executor;
    if (options.pipeline) overrides.pipeline = options.pipeline;
    if (options.router) {
      if (options.router !== 'native' && options.router !== '9router') {
        throw new Error(`unknown router "${options.router}" (available: native, 9router)`);
      }
      overrides.router = { mode: options.router };
    }
    const config = await loadConfig({ projectDir, overrides });
    const runsDir = resolve(projectDir, '.runs');
    const app = new App(cwd, config, runsDir, options.executor, options.router);
    app.configSource = existsSync(resolve(projectDir, 'config.yaml'))
      ? 'project'
      : existsSync(join(resolveGlobalDir(), 'config.yaml'))
        ? 'global'
        : 'defaults';
    return app;
  }

  /**
   * Resolve agent definitions, merging config overrides onto built-ins and
   * loading role instructions (project > global > bundled).
   */
  getAgents(): Map<string, AgentDefinition> {
    const map = new Map<string, AgentDefinition>();
    for (const agent of BUILTIN_AGENTS) {
      const override = this.config.agents[agent.id];
      // Precedence: CLI flag > per-agent config > global default.
      const executor = this.cliExecutor ?? override?.executor ?? this.config.executor;
      const routerMode = this.cliRouter ?? override?.router ?? this.config.router.mode;
      map.set(agent.id, {
        ...agent,
        executor,
        router: routerMode ?? agent.router,
        model: override?.model ?? agent.model,
        instructions: this.loadAgentInstructions(agent.id),
      });
    }
    return map;
  }

  /**
   * Load agent instruction text from the first existing location:
   * .volibear/agents/<id>.md, ~/.volibear/agents/<id>.md, bundled agents/.
   */
  loadAgentInstructions(agentId: string): string | undefined {
    const candidates = [
      resolve(this.projectDir, 'agents', `${agentId}.md`),
      resolve(resolveGlobalDir(), 'agents', `${agentId}.md`),
      resolve(bundledAgentsDir(), `${agentId}.md`),
    ];
    for (const file of candidates) {
      if (existsSync(file)) {
        try {
          return readFileSync(file, 'utf-8');
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  /** Fail fast when any agent references an executor that is not registered. */
  validateExecutors(): void {
    const available = this.executors.list().map((e) => e.id).sort();
    const problems: string[] = [];
    for (const agent of this.getAgents().values()) {
      if (!this.executors.has(agent.executor)) {
        problems.push(`agent "${agent.id}" uses unknown executor "${agent.executor}" (available: ${available.join(', ')})`);
      }
    }
    if (problems.length > 0) {
      throw new Error(`executor configuration error:\n  ${problems.join('\n  ')}`);
    }
  }

  /**
   * Resolve executor map from config. All registered adapters are available;
   * agents reference one by id. Missing binaries fail loudly at invocation —
   * there is no silent fallback to the mock executor.
   */
  getExecutors() {
    const map = new Map<string, import('@volibear/contracts').Executor>();
    for (const executor of this.executors.list()) {
      map.set(executor.id, executor);
    }
    return map;
  }

  /**
   * Create a rubberduck driver: uses the configured coding CLI when available
   * (LLM-backed discovery), falls back to MockRubberduckDriver for testing.
   */
  createRubberduckDriver(_runId?: string): RubberduckDriver {
    const agents = this.getAgents();
    const rubberduckAgent = agents.get('rubberduck');
    const executorId = rubberduckAgent?.executor ?? this.config.executor;

    // Use MockRubberduckDriver only when the rubberduck agent's executor is
    // explicitly "mock" — all other executors (opencode, codex, claude) get
    // an LLM-backed driver that drives real discovery through the CLI.
    if (executorId === 'mock') {
      return new MockRubberduckDriver();
    }

    const executor = this.getExecutors().get(executorId);
    if (!executor) {
      // Fallback to mock when the configured executor isn't available.
      return new MockRubberduckDriver();
    }

    return new CliRubberduckDriver(executor, {
      cwd: this.cwd,
      runDir: _runId ? this.runStore.runDir(_runId) : this.cwd,
      model: rubberduckAgent?.model,
      router: rubberduckAgent?.router,
      instructions: rubberduckAgent?.instructions,
    });
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
    const rubberduck = this.createRubberduckDriver(runId);
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
      rubberduck,
      rubberduckInteraction: options.rubberduckInteraction,
      findings: options.findings,
      onStage: options.onStage,
    });
  }
}
