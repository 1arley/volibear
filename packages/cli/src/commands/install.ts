import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { CliOptions } from '../cli.js';
import { bundledPipelinesDir, bundledAgentsDir } from '../app.js';
import { getHomeDir, displayPath } from '../install/paths.js';
import { readIntegrationTemplate } from '../install/templates.js';
import { createInstallPlan } from '../install/plan.js';
import { applyInstallPlan, realFS } from '../install/apply.js';
import { runInstallWizard } from '../install/wizard.js';
import type { InstallSelection, IntegrationId, InstallPipeline, InstallExecutor, RouterMode } from '../install/types.js';

const KNOWN_EXECUTORS = ['mock', 'opencode', 'codex', 'claude'] as const;
const KNOWN_INTEGRATIONS = ['opencode', 'claude', 'codex'] as const;
const KNOWN_PIPELINES = ['feature', 'fix'] as const;

export type InstallRequest =
  | { mode: 'wizard' }
  | { mode: 'flags'; selection: InstallSelection }
  | { mode: 'error'; message: string };

/**
 * Decide between the interactive wizard and the flag-based install.
 * Wizard only when stdin is a TTY and the user gave no install input.
 */
export function shouldUseInstallWizard(
  positional: readonly string[],
  options: CliOptions,
  isTTY: boolean,
): boolean {
  if (!isTTY) return false;
  const hasInstallInput =
    positional.length > 0 ||
    options.project === true ||
    options.global === true ||
    options.both === true ||
    options.executor !== undefined ||
    options.router !== undefined ||
    options.pipeline !== undefined ||
    options.acceptDefaults === true ||
    options.force === true;
  return !hasInstallInput;
}

/**
 * Convert flag/positional input into an install selection.
 * Pure: returns an error message instead of printing.
 */
export function selectionFromFlags(
  positional: readonly string[],
  options: CliOptions,
): { ok: true; selection: InstallSelection } | { ok: false; message: string } {
  // Scope resolution with conflict detection.
  const explicitScopes = [
    options.project ? '--project' : null,
    options.global ? '--global' : null,
    options.both ? '--both' : null,
  ].filter(Boolean);
  if (explicitScopes.length > 1) {
    return { ok: false, message: 'Choose only one installation scope: --project, --global, or --both.' };
  }

  const scope: InstallSelection['scope'] =
    options.both ? 'both'
      : options.global ? 'global'
        : options.project ? 'project'
          : positional[0] === 'global' ? 'global'
            : positional[0] === 'project' ? 'project'
              : 'project';

  // Router.
  let router: RouterMode;
  if (options.router === undefined || options.router === 'native') {
    router = 'native';
  } else if (options.router === '9router') {
    router = '9router';
  } else {
    return { ok: false, message: `Unknown router "${options.router}" (available: native, 9router).` };
  }

  // Integrations from positionals.
  const positionals = positional.filter(
    (p) => p !== 'global' && p !== 'project' && p !== 'help' && p !== '-h' && p !== '--help',
  );
  const integrations: IntegrationId[] = [];
  for (const p of positionals) {
    if (!KNOWN_INTEGRATIONS.includes(p as IntegrationId)) {
      return {
        ok: false,
        message: `Unknown integration "${p}". Available: ${KNOWN_INTEGRATIONS.join(', ')}.`,
      };
    }
    integrations.push(p as IntegrationId);
  }

  // Pipelines.
  const pipelines: InstallPipeline[] = options.pipeline
    ? [options.pipeline as InstallPipeline]
    : [...KNOWN_PIPELINES];
  for (const p of pipelines) {
    if (!KNOWN_PIPELINES.includes(p as (typeof KNOWN_PIPELINES)[number])) {
      return { ok: false, message: `Unknown pipeline "${p}". Available: ${KNOWN_PIPELINES.join(', ')}.` };
    }
  }

  // Executor.
  const executor: InstallExecutor = options.executor
    ? (options.executor as InstallExecutor)
    : 'mock';
  if (!KNOWN_EXECUTORS.includes(executor as (typeof KNOWN_EXECUTORS)[number])) {
    return { ok: false, message: `Unknown executor "${executor}". Available: ${KNOWN_EXECUTORS.join(', ')}.` };
  }

  return {
    ok: true,
    selection: {
      scope,
      integrations,
      pipelines,
      executor,
      router,
      force: options.force ?? false,
    },
  };
}

/** Build the full install request (pure, testable). */
export function resolveInstallRequest(
  positional: readonly string[],
  options: CliOptions,
  isTTY: boolean,
): InstallRequest {
  if (shouldUseInstallWizard(positional, options, isTTY)) {
    return { mode: 'wizard' };
  }
  const parsed = selectionFromFlags(positional, options);
  if (!parsed.ok) return { mode: 'error', message: parsed.message };
  return { mode: 'flags', selection: parsed.selection };
}

/**
 * volibear install [scope] [integrations...]
 *
 * Interactive wizard (TTY, no flags) or non-interactive mode (flags / stdin).
 * Installs the Volibear runtime (.volibear/) plus optional native CLI bridge
 * agents (volibear.md / volibear.toml in each supported coding CLI).
 */
export async function runInstall(
  positional: string[],
  options: CliOptions,
): Promise<number> {
  const isTTY = process.stdin.isTTY === true;
  const request = resolveInstallRequest(positional, options, isTTY);

  switch (request.mode) {
    case 'wizard':
      return runWizardInstall();
    case 'error':
      console.error(request.message);
      return 1;
    case 'flags':
      return runNonInteractive(request.selection);
  }
}

// ── Interactive wizard ──────────────────────────────────

async function runWizardInstall(): Promise<number> {
  // The wizard derives the relevant existing config/bridge paths itself,
  // re-querying after every scope/integration change (MED-3), so overwrite
  // prompts only cover files the final selection would touch.
  const outcome = await runInstallWizard();

  if (outcome.kind === 'cancelled') {
    console.log('Installation cancelled.');
    return 2;
  }

  const forcedOverwritePaths = [
    ...outcome.selection.overwriteIntegrationPaths,
    ...outcome.selection.overwriteConfigPaths,
  ];

  const selection: InstallSelection = {
    scope: outcome.selection.scope,
    integrations: outcome.selection.integrations,
    pipelines: outcome.selection.pipelines,
    executor: outcome.selection.executor,
    router: outcome.selection.router,
    // force=false: the plan starts by keeping every existing file, then
    // runNonInteractive flips only the paths the wizard explicitly chose.
    force: false,
  };

  return runNonInteractive(selection, forcedOverwritePaths);
}

// ── Non-interactive executor ────────────────────────────

async function runNonInteractive(
  selection: InstallSelection,
  forcedOverwritePaths?: string[],
): Promise<number> {
  let homeDir: string;
  try {
    homeDir = getHomeDir();
  } catch (e) {
    if (selection.scope === 'global' || selection.scope === 'both') {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
    homeDir = '';
  }

  const cwd = process.cwd();
  const context = { cwd, homeDir };

  const deps = {
    exists: (p: string) => existsSync(p),
    readTemplate: (integration: IntegrationId) => readIntegrationTemplate(integration),
    readBundledPipeline: (name: string) => {
      const p = resolve(bundledPipelinesDir(), `${name}.yaml`);
      return existsSync(p) ? readFileSync(p, 'utf-8') : undefined;
    },
    readBundledAgent: (name: string) => {
      const p = resolve(bundledAgentsDir(), name);
      return existsSync(p) ? readFileSync(p, 'utf-8') : undefined;
    },
  };

  const plan = createInstallPlan(selection, context, deps);

  // Apply the wizard's explicitly chosen bridge overwrites.
  if (forcedOverwritePaths) {
    for (const file of plan.files) {
      if (file.action === 'keep' && forcedOverwritePaths.includes(file.path)) {
        // 'overwrite' (not 'create') so the report says "overwritten" (LOW-6).
        file.action = 'overwrite';
        // Config files always carry content in the plan; bridge files keep
        // content undefined while 'keep', so re-read the template here.
        if (file.integration) {
          file.content = deps.readTemplate(file.integration);
        }
      }
    }
  }

  const result = applyInstallPlan(plan, realFS);

  // ── Report ──────────────────────────────────────────────
  const scopeLabel = selection.scope === 'both'
    ? 'in project and global scopes'
    : selection.scope === 'global'
      ? 'globally'
      : 'in this project';

  // MED-4: surface per-file I/O failures with context about what was
  // already applied before the failure stopped the install.
  const failures = result.files.filter((f) => f.outcome === 'failed');
  if (failures.length > 0) {
    console.error('Volibear install failed.\n');
    const appliedBefore = result.files.filter(
      (f) => f.outcome === 'written' || f.outcome === 'overwritten',
    );
    if (appliedBefore.length > 0) {
      console.error('  Applied before the failure:');
      for (const f of appliedBefore) {
        console.error(`    ${f.outcome}: ${displayPath(f.file.path, homeDir)}`);
      }
      console.error('');
    }
    for (const f of failures) {
      console.error(`  failed: ${displayPath(f.file.path, homeDir)}`);
      console.error(`    ${f.error ?? 'unknown I/O error'}`);
    }
    return 1;
  }

  const byScope: Record<string, { written: string[]; overwritten: string[]; kept: string[] }> = {};
  for (const file of result.files) {
    const key = file.file.scope;
    if (!byScope[key]) byScope[key] = { written: [], overwritten: [], kept: [] };
    if (file.outcome === 'written') byScope[key].written.push(file.file.path);
    else if (file.outcome === 'overwritten') byScope[key].overwritten.push(file.file.path);
    else if (file.outcome === 'kept') byScope[key].kept.push(file.file.path);
  }

  console.log(`Volibear installed ${scopeLabel}.\n`);

  for (const [scope, group] of Object.entries(byScope)) {
    console.log(`  ${scope}:`);
    if (group.written.length > 0) {
      console.log(`    written: ${group.written.map((p) => displayPath(p, homeDir)).join(', ')}`);
    }
    if (group.overwritten.length > 0) {
      console.log(`    overwritten: ${group.overwritten.map((p) => displayPath(p, homeDir)).join(', ')}`);
    }
    if (group.kept.length > 0) {
      console.log(`    kept: ${group.kept.map((p) => displayPath(p, homeDir)).join(', ')}`);
    }
  }

  for (const warning of result.warnings) {
    console.log(`  note: ${warning}`);
  }

  if (forcedOverwritePaths === undefined && plan.files.some((f) => f.action === 'keep')) {
    console.log('  note: use --force to overwrite existing files.');
  }

  return 0;
}