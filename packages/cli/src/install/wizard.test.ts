import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedIntegration, IntegrationId, InstallScope } from './types.js';

// ── Mock @clack/prompts ─────────────────────────────────

const clackMock = {
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  note: vi.fn(),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
};

vi.mock('@clack/prompts', () => clackMock);

// Must import AFTER mock setup
const { runInstallWizard } = await import('./wizard.js');

const CANCEL = Symbol('cancel');

const detections: DetectedIntegration[] = [
  { id: 'opencode', command: 'opencode', available: true },
  { id: 'claude', command: 'claude', available: false },
  { id: 'codex', command: 'codex', available: true },
];

const none: DetectedIntegration[] = [
  { id: 'opencode', command: 'opencode', available: false },
  { id: 'claude', command: 'claude', available: false },
  { id: 'codex', command: 'codex', available: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default: isCancel returns false for non-symbol values
  clackMock.isCancel.mockImplementation((v: unknown) => typeof v === 'symbol');
});

describe('runInstallWizard', () => {
  it('returns confirmed selection with smart defaults', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode', 'codex']);
    clackMock.confirm.mockResolvedValue(true);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('project');
      expect(outcome.selection.integrations).toEqual(['opencode', 'codex']);
    }

    // Should call intro, select, multiselect, confirm (summary), confirm (proceed)
    expect(clackMock.intro).toHaveBeenCalled();
    expect(clackMock.select).toHaveBeenCalled();
    expect(clackMock.multiselect).toHaveBeenCalled();
  });

  it('cancels when scope selection is cancelled', async () => {
    clackMock.select.mockResolvedValue(CANCEL);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('cancelled');
    expect(clackMock.outro).toHaveBeenCalledWith('Cancelled.');
  });

  it('cancels when integrations selection is cancelled', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(CANCEL);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('cancelled');
  });

  it('cancels when summary confirm is cancelled', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(CANCEL);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('cancelled');
  });

  it('cancels when user declines summary confirm', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(false);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('cancelled');
  });

  it('preselects detected integrations', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode', 'codex']);
    clackMock.confirm.mockResolvedValue(true);

    await runInstallWizard(detections);

    // Check multiselect was called with initialValues matching detected IDs
    const multiselectCall = clackMock.multiselect.mock.calls[0][0];
    expect(multiselectCall.initialValues).toEqual(['opencode', 'codex']);
  });

  it('handles global scope', async () => {
    clackMock.select.mockResolvedValue('global');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(true);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('global');
    }
  });

  it('handles both scope', async () => {
    clackMock.select.mockResolvedValue('both');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(true);

    const outcome = await runInstallWizard(detections);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('both');
    }
  });

  it('works when no CLIs are detected', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue([]);
    clackMock.confirm.mockResolvedValue(true);

    const outcome = await runInstallWizard(none);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.integrations).toEqual([]);
    }
  });

  it('prompts for config overwrite when existing config is found', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: ['/work/repo/.volibear/config.yaml'],
      bridges: [],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    // First confirm: overwrite configs? Yes. Second confirm: proceed? Yes.
    clackMock.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const outcome = await runInstallWizard(detections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.overwriteConfigPaths).toEqual(['/work/repo/.volibear/config.yaml']);
    }
  });

  it('keeps existing config when user declines overwrite', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: ['/work/repo/.volibear/config.yaml'],
      bridges: [],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    // First confirm: overwrite configs? No. Second confirm: proceed? Yes.
    clackMock.confirm
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const outcome = await runInstallWizard(detections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.overwriteConfigPaths).toEqual([]);
    }
  });

  it('prompts for bridge overwrite when existing bridges are found', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: [],
      bridges: ['/work/repo/.opencode/agents/volibear.md'],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    // First confirm: overwrite bridges? Yes. Second confirm: proceed? Yes.
    clackMock.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const outcome = await runInstallWizard(detections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.overwriteIntegrationPaths).toEqual(['/work/repo/.opencode/agents/volibear.md']);
    }
  });

  it('shows note with summary', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(true);

    await runInstallWizard(detections);

    expect(clackMock.note).toHaveBeenCalled();
    const noteArg = clackMock.note.mock.calls[0][0];
    expect(noteArg).toContain('Scope');
    expect(noteArg).toContain('Pipelines');
    expect(noteArg).toContain('Executor');
  });
});
