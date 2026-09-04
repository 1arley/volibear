import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedIntegration, InstallScope, IntegrationId } from './types.js';

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

const { runInstallWizard } = await import('./wizard.js');

const CANCEL = Symbol('cancel');

const fakeDetections: DetectedIntegration[] = [
  { id: 'opencode', command: 'opencode', available: true },
  { id: 'claude', command: 'claude', available: false },
  { id: 'codex', command: 'codex', available: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  clackMock.isCancel.mockImplementation((v: unknown) => typeof v === 'symbol');
});

describe('runInstallWizard (integration)', () => {
  it('runs the full happy path and returns a confirmed selection', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: [],
      bridges: [],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(true);

    const outcome = await runInstallWizard(fakeDetections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('project');
      expect(outcome.selection.integrations).toEqual(['opencode']);
      expect(outcome.selection.overwriteConfigPaths).toEqual([]);
      expect(outcome.selection.overwriteIntegrationPaths).toEqual([]);
    }
  });

  it('cancels on scope cancel', async () => {
    clackMock.select.mockResolvedValue(CANCEL);

    const outcome = await runInstallWizard(fakeDetections);
    expect(outcome.kind).toBe('cancelled');
  });

  it('cancels on integrations cancel', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(CANCEL);

    const outcome = await runInstallWizard(fakeDetections);
    expect(outcome.kind).toBe('cancelled');
  });

  it('cancels on summary decline', async () => {
    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(false);

    const outcome = await runInstallWizard(fakeDetections);
    expect(outcome.kind).toBe('cancelled');
  });

  it('walks the overwrite screens for existing configs', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: ['/work/repo/.volibear/config.yaml', '/home/alice/.volibear/config.yaml'],
      bridges: [],
    });

    clackMock.select.mockResolvedValue('both');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    // Overwrite configs: Yes; Proceed: Yes
    clackMock.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const outcome = await runInstallWizard(fakeDetections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.scope).toBe('both');
      expect(outcome.selection.overwriteConfigPaths).toEqual([
        '/work/repo/.volibear/config.yaml',
        '/home/alice/.volibear/config.yaml',
      ]);
    }
  });

  it('walks the overwrite screens for existing bridges', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: [],
      bridges: ['/work/repo/.opencode/agents/volibear.md'],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    // Overwrite bridges: Yes; Proceed: Yes
    clackMock.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const outcome = await runInstallWizard(fakeDetections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.overwriteIntegrationPaths).toEqual(['/work/repo/.opencode/agents/volibear.md']);
    }
  });

  it('handles both config and bridge overwrites', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: ['/work/repo/.volibear/config.yaml'],
      bridges: ['/work/repo/.opencode/agents/volibear.md'],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    // Overwrite configs: No; Overwrite bridges: Yes; Proceed: Yes
    clackMock.confirm
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const outcome = await runInstallWizard(fakeDetections, { existingPaths });

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.selection.overwriteConfigPaths).toEqual([]);
      expect(outcome.selection.overwriteIntegrationPaths).toEqual(['/work/repo/.opencode/agents/volibear.md']);
    }
  });

  it('cancels when user declines config overwrite prompt', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: ['/work/repo/.volibear/config.yaml'],
      bridges: [],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(CANCEL);

    const outcome = await runInstallWizard(fakeDetections, { existingPaths });
    expect(outcome.kind).toBe('cancelled');
  });

  it('skips overwrite prompts when no existing files', async () => {
    const existingPaths = (): { configs: string[]; bridges: string[] } => ({
      configs: [],
      bridges: [],
    });

    clackMock.select.mockResolvedValue('project');
    clackMock.multiselect.mockResolvedValue(['opencode']);
    clackMock.confirm.mockResolvedValue(true);

    const outcome = await runInstallWizard(fakeDetections, { existingPaths });

    // Only one confirm call (the proceed confirmation)
    expect(clackMock.confirm).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('confirmed');
  });
});
