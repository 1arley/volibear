/**
 * Interactive TUI wizard for `volibear install`.
 *
 * Uses @clack/prompts for a polished, professional experience.
 * Defaults: pipelines=feature+fix, executor=auto-detect, router=native.
 * Only asks the questions that matter: scope + integrations.
 */
import { intro, outro, select, multiselect, confirm, note, isCancel } from '@clack/prompts';
import { detectIntegrations, detectedIntegrationIds } from './detection.js';
import { getHomeDir, computeExistingPaths } from './paths.js';
import { getIntegration } from './integrations/index.js';
import { existsSync } from 'node:fs';
import type { DetectedIntegration, IntegrationId, InstallScope } from './types.js';

// ── Types ───────────────────────────────────────────────

export type ExistingPathsFn = (
  scope: InstallScope,
  integrations: IntegrationId[],
) => { configs: string[]; bridges: string[] };

export interface WizardSelection {
  scope: InstallScope;
  integrations: IntegrationId[];
  overwriteConfigPaths: string[];
  overwriteIntegrationPaths: string[];
}

export type WizardOutcome =
  | { kind: 'confirmed'; selection: WizardSelection }
  | { kind: 'cancelled' };

// ── Detection helpers ───────────────────────────────────

const INTEGRATION_LIST: IntegrationId[] = ['opencode', 'claude', 'codex'];

// ── Default dependencies ────────────────────────────────

function safeHomeDir(): string {
  try { return getHomeDir(); } catch { return ''; }
}

function defaultExists(p: string): boolean {
  return existsSync(p);
}

function defaultExistingPaths(scope: InstallScope, integrations: IntegrationId[]) {
  return computeExistingPaths(scope, integrations, {
    cwd: process.cwd(),
    homeDir: safeHomeDir(),
  }, defaultExists);
}

// ── Wizard entry point ─────────────────────────────────

export async function runInstallWizard(
  detections?: DetectedIntegration[],
  deps?: {
    detectIntegrations?: () => DetectedIntegration[];
    existingPaths?: ExistingPathsFn;
  },
): Promise<WizardOutcome> {
  const actualDetections = detections ?? (deps?.detectIntegrations ?? detectIntegrations)();
  const existingPathsFn = deps?.existingPaths ?? defaultExistingPaths;

  const detected = detectedIntegrationIds(actualDetections);
  const availableCount = actualDetections.filter((d) => d.available).length;

  // ── Intro ──────────────────────────────────────────
  intro('⚡ volibear');

  // ── Scope ──────────────────────────────────────────
  const scope = await select({
    message: 'Where to install?',
    options: [
      { value: 'project', label: 'Project', hint: 'Current directory' },
      { value: 'global', label: 'Global', hint: '~/.volibear/' },
      { value: 'both', label: 'Both', hint: 'Project + global' },
    ],
    initialValue: 'project',
  }) as InstallScope | symbol;

  if (isCancel(scope)) {
    outro('Cancelled.');
    return { kind: 'cancelled' };
  }

  // ── Integrations ───────────────────────────────────
  const integrationOptions = INTEGRATION_LIST.map((id) => ({
    value: id,
    label: getIntegration(id).label,
    hint: actualDetections.find((d) => d.id === id)?.available ? 'detected' : 'not found',
  }));

  const integrations = await multiselect({
    message: 'Which coding CLIs to bridge?',
    options: integrationOptions,
    initialValues: detected,
    required: false,
  }) as IntegrationId[] | symbol;

  if (isCancel(integrations)) {
    outro('Cancelled.');
    return { kind: 'cancelled' };
  }

  // ── Detect existing files ──────────────────────────
  const existing = existingPathsFn(scope, integrations);
  let overwriteConfigPaths: string[] = [];
  let overwriteIntegrationPaths: string[] = [];

  if (existing.configs.length > 0) {
    const overwriteConfigs = await confirm({
      message: `Overwrite existing config? (${existing.configs.length} file${existing.configs.length > 1 ? 's' : ''})`,
      initialValue: false,
    });

    if (isCancel(overwriteConfigs)) {
      outro('Cancelled.');
      return { kind: 'cancelled' };
    }

    if (overwriteConfigs) {
      overwriteConfigPaths = [...existing.configs];
    }
  }

  if (existing.bridges.length > 0) {
    const overwriteBridges = await confirm({
      message: `Overwrite existing bridge agents? (${existing.bridges.length} file${existing.bridges.length > 1 ? 's' : ''})`,
      initialValue: false,
    });

    if (isCancel(overwriteBridges)) {
      outro('Cancelled.');
      return { kind: 'cancelled' };
    }

    if (overwriteBridges) {
      overwriteIntegrationPaths = [...existing.bridges];
    }
  }

  // ── Summary ────────────────────────────────────────
  const scopeLabel = scope === 'both' ? 'Project + Global' : scope.charAt(0).toUpperCase() + scope.slice(1);
  const cliLabels = integrations.length > 0
    ? integrations.map((i) => getIntegration(i).label).join(', ')
    : '(none)';

  const summaryLines = [
    `Scope      ${scopeLabel}`,
    `CLI bridges ${cliLabels}`,
    `Pipelines  feature, fix`,
    `Executor   ${integrations.includes('opencode') ? 'opencode' : 'mock'}`,
    `Router     native`,
  ];

  if (overwriteConfigPaths.length > 0) {
    summaryLines.push(`Overwrite  ${overwriteConfigPaths.length} config file(s)`);
  }
  if (overwriteIntegrationPaths.length > 0) {
    summaryLines.push(`Overwrite  ${overwriteIntegrationPaths.length} bridge file(s)`);
  }

  note(summaryLines.join('\n'), 'Installation summary');

  // ── Confirm ────────────────────────────────────────
  const proceed = await confirm({
    message: 'Proceed with installation?',
    initialValue: true,
  });

  if (isCancel(proceed) || !proceed) {
    outro('Cancelled.');
    return { kind: 'cancelled' };
  }

  // ── Done ───────────────────────────────────────────
  return {
    kind: 'confirmed',
    selection: {
      scope,
      integrations,
      overwriteConfigPaths,
      overwriteIntegrationPaths,
    },
  };
}
