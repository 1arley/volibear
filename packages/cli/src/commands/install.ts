import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spinner, outro } from '@clack/prompts';
import { CliOptions } from '../cli.js';
import { bundledPipelinesDir, bundledAgentsDir } from '../app.js';
import { getHomeDir, displayPath } from '../install/paths.js';
import { readIntegrationTemplate, renderOpenCodeRoleAgent, type OpenCodeRole } from '../install/templates.js';
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
    : integrations.includes('opencode') ? 'opencode' : 'mock';
  if (!KNOWN_EXECUTORS.includes(executor as (typeof KNOWN_EXECUTORS)[number])) {
    return { ok: false, message: `Unknown executor "${options.executor}". Available: ${KNOWN_EXECUTORS.join(', ')}.` };
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
  const outcome = await runInstallWizard();

  if (outcome.kind === 'cancelled') {
    return 2;
  }

  const forcedOverwritePaths = [
    ...outcome.selection.overwriteIntegrationPaths,
    ...outcome.selection.overwriteConfigPaths,
  ];

  // Wizard uses smart defaults: pipelines=feature+fix, executor=auto, router=native
  const integrations = outcome.selection.integrations;
  const selection: InstallSelection = {
    scope: outcome.selection.scope,
    integrations,
    pipelines: ['feature', 'fix'],
    executor: integrations.includes('opencode') ? 'opencode' : 'mock',
    router: 'native',
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
        file.action = 'overwrite';
        if (file.integration) {
          const roleMatch = file.path.match(/volibear-(rubberduck|architect|developer|reviewer|fixer|verifier)\.md$/);
          if (file.integration === 'opencode' && roleMatch) {
            const role = roleMatch[1] as OpenCodeRole;
            const body = deps.readBundledAgent(`${role}.md`);
            file.content = body === undefined ? undefined : renderOpenCodeRoleAgent(role, body);
          } else {
            file.content = deps.readTemplate(file.integration);
          }
        }
      }
    }
  }

  const s = spinner();
  s.start('Installing files...');

  let result;
  try {
    result = applyInstallPlan(plan, realFS);
  } catch (err) {
    s.stop('Install failed.');
    throw err;
  }

  const failures = result.files.filter((f) => f.outcome === 'failed');
  if (failures.length > 0) {
    s.stop('Install completed with errors.');

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

  const written = result.files.filter((f) => f.outcome === 'written' || f.outcome === 'overwritten');
  s.stop(`Installed ${written.length} file${written.length !== 1 ? 's' : ''}`);

  // ── Next steps ──────────────────────────────────────
  const scopeLabel = selection.scope === 'both'
    ? 'in project and global scopes'
    : selection.scope === 'global'
      ? 'globally'
      : 'in this project';

  outro(`Volibear installed ${scopeLabel}.\n\nRun ${written.length > 0 ? '`volibear build feature`' : '`volibear install`'} to get started.`);

  return 0;
}
