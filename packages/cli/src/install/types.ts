/**
 * Pure types for the Volibear install flow (runtime files + native CLI bridges).
 * This module avoids filesystem and process access so planning is unit-testable.
 */

export const INTEGRATION_IDS = ['opencode', 'claude', 'codex'] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const INSTALL_SCOPES = ['project', 'global', 'both'] as const;
export type InstallScope = (typeof INSTALL_SCOPES)[number];

export const PIPELINE_NAMES = ['feature', 'fix'] as const;
export type InstallPipeline = (typeof PIPELINE_NAMES)[number];

export const EXECUTOR_NAMES = ['mock', 'opencode', 'codex', 'claude'] as const;
export type InstallExecutor = (typeof EXECUTOR_NAMES)[number];

export type RouterMode = 'native' | '9router';

export interface InstallSelection {
  scope: InstallScope;
  integrations: IntegrationId[];
  pipelines: InstallPipeline[];
  executor: InstallExecutor;
  router: RouterMode;
  force: boolean;
}

export interface DetectedIntegration {
  id: IntegrationId;
  command: string;
  available: boolean;
}

export type PlannedAction = 'create' | 'overwrite' | 'keep';

export interface PlannedFile {
  kind:
    | 'config'
    | 'pipeline'
    | 'agent-instructions'
    | 'integration-agent'
    | 'gitignore';
  path: string;
  action: PlannedAction;
  content?: string;
  integration?: IntegrationId;
  scope: Exclude<InstallScope, 'both'>;
}

export interface InstallPlan {
  selection: InstallSelection;
  files: PlannedFile[];
  warnings: string[];
}

export interface AppliedFile {
  file: PlannedFile;
  outcome: 'written' | 'overwritten' | 'kept' | 'skipped' | 'failed';
  /** Human-readable I/O error message when outcome is 'failed'. */
  error?: string;
}

export interface InstallResult {
  files: AppliedFile[];
  warnings: string[];
}
