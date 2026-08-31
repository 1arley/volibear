import { commandExists } from '@volibear/executors';
import type { DetectedIntegration, IntegrationId } from './types.js';

export const INTEGRATION_COMMANDS: Record<IntegrationId, string> = {
  opencode: 'opencode',
  claude: 'claude',
  codex: 'codex',
};

export type CommandDetector = (command: string) => boolean;

/**
 * Probe each known coding CLI on the current PATH.
 * The default detector wraps `commandExists` from @volibear/executors.
 */
export function detectIntegrations(
  detector?: CommandDetector,
): DetectedIntegration[] {
  const check = detector ?? commandExists;
  const ids: IntegrationId[] = ['opencode', 'claude', 'codex'];
  return ids.map((id) => ({
    id,
    command: INTEGRATION_COMMANDS[id],
    available: check(INTEGRATION_COMMANDS[id]),
  }));
}

/** Return only the IDs of CLIs that were found on PATH. */
export function detectedIntegrationIds(
  detections: readonly DetectedIntegration[],
): IntegrationId[] {
  return detections.filter((d) => d.available).map((d) => d.id);
}