import { describe, it, expect } from 'vitest';
import { initialState, reduceWizardState } from './wizard.js';
import type { ExistingPathsFn, WizardKey, WizardState } from './wizard.js';
import type { DetectedIntegration } from './types.js';

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

function fresh(dets: DetectedIntegration[] = detections): WizardState {
  return initialState(dets, [], [], '/home/alice', '/work/repo');
}

/** Send keys and assert the reducer returns a state (not an outcome). */
function step(state: WizardState, key: WizardKey, existingPaths?: ExistingPathsFn): WizardState {
  const result = reduceWizardState(state, key, existingPaths);
  if ('outcome' in result) throw new Error(`unexpected outcome for key ${key}`);
  return result;
}

/**
 * Screen navigation from `welcome`:
 * welcome → detection → scope → integrations → pipelines → executor → router → summary
 */
function navigateTo(state: WizardState, target: string, existingPaths?: ExistingPathsFn): WizardState {
  const order = ['welcome', 'detection', 'scope', 'integrations', 'pipelines', 'executor', 'router', 'summary', 'config-overwrite', 'bridge-overwrite'];
  let s = state;
  while (s.screen !== target) {
    const nextIdx = order.indexOf(s.screen) + 1;
    s = step(s, 'enter', existingPaths);
    if (s.screen === order[nextIdx - 1] && order.indexOf(s.screen) === nextIdx - 1) {
      // advanced; continue
    }
    if (s.screen === target) break;
  }
  return s;
}

describe('reduceWizardState', () => {
  it('advances from welcome on Enter', () => {
    const next = step(fresh(), 'enter');
    expect(next.screen).toBe('detection');
  });

  it('cancels from welcome on Esc', () => {
    const result = reduceWizardState(fresh(), 'escape');
    expect('outcome' in result && result.outcome.kind).toBe('cancelled');
  });

  it('clamps cursor at top and bottom', () => {
    const s = navigateTo(fresh(), 'scope');
    expect(s.screen).toBe('scope');
    // up at top stays at 0
    const up = step(s, 'up');
    expect(up.cursor).toBe(0);
    // down twice reaches 2 (max)
    const down1 = step(s, 'down');
    const down2 = step(down1, 'down');
    expect(down2.cursor).toBe(2);
    const down3 = step(down2, 'down');
    expect(down3.cursor).toBe(2);
  });

  it('preselects detected integrations and allows toggling', () => {
    const s = fresh();
    expect(s.selection.integrations).toEqual(['opencode', 'codex']);
    const atIntegrations = navigateTo(s, 'integrations');
    expect(atIntegrations.screen).toBe('integrations');
    // cursor 0 = opencode; toggle it off
    const toggled = step(atIntegrations, 'space');
    expect(toggled.selection.integrations).toEqual(['codex']);
  });
  it('does not block advancing when no CLI is detected', () => {
    const s = fresh(none);
    expect(s.selection.integrations).toEqual([]);
    const atPipelines = navigateTo(s, 'pipelines');
    expect(atPipelines.screen).toBe('pipelines');
  });

  it('requires at least one pipeline', () => {
    let s = navigateTo(fresh(), 'pipelines');
    expect(s.screen).toBe('pipelines');
    // toggle feature off (cursor 0)
    s = step(s, 'space');
    // toggle fix off (move down + space)
    s = step(s, 'down');
    s = step(s, 'space');
    expect(s.selection.pipelines).toEqual([]);
    // Enter should error, not advance
    const err = step(s, 'enter');
    expect(err.screen).toBe('pipelines');
    expect(err.errors.length).toBeGreaterThan(0);
  });

  it('allows advancing once a pipeline is selected', () => {
    const s = navigateTo(fresh(), 'pipelines');
    const next = step(s, 'enter');
    expect(next.screen).toBe('executor');
  });

  it('navigates back one screen at a time on Esc', () => {
    let s = navigateTo(fresh(), 'integrations');
    expect(s.screen).toBe('integrations');
    s = step(s, 'escape');
    expect(s.screen).toBe('scope');
    s = step(s, 'escape');
    expect(s.screen).toBe('detection');
  });

  it('confirms from summary and returns the exact selection', () => {
    const s = navigateTo(fresh(), 'summary');
    expect(s.screen).toBe('summary');
    const result = reduceWizardState(s, 'enter');
    if (!('outcome' in result)) throw new Error('expected outcome');
    expect(result.outcome.kind).toBe('confirmed');
    const sel = (result.outcome as { kind: 'confirmed'; selection: WizardState['selection'] }).selection;
    expect(sel.scope).toBe('project');
    expect(sel.integrations).toEqual(['opencode', 'codex']);
    expect(sel.pipelines).toEqual(['feature', 'fix']);
    expect(sel.executor).toBe('mock');
    expect(sel.router).toBe('native');
  });

  it('cancels via summary Cancel option', () => {
    let s = navigateTo(fresh(), 'summary');
    s = step(s, 'down'); // cursor -> Cancel
    const result = reduceWizardState(s, 'enter');
    if (!('outcome' in result)) throw new Error('expected outcome');
    expect(result.outcome.kind).toBe('cancelled');
  });

  it('ctrl-c cancels anywhere', () => {
    const result = reduceWizardState(fresh(), 'ctrl-c');
    expect('outcome' in result && result.outcome.kind).toBe('cancelled');
  });

  it('handles existing config overwrite screen (per-path, HIGH-1)', () => {
    let s = initialState(detections, ['/work/repo/.volibear/config.yaml'], [], '/home/alice', '/work/repo');
    s = navigateTo(s, 'config-overwrite');
    expect(s.screen).toBe('config-overwrite');
    // default keeps
    expect(s.selection.overwriteConfigPaths).toEqual([]);
    // toggle the (single) config on
    s = step(s, 'space');
    expect(s.selection.overwriteConfigPaths).toEqual(['/work/repo/.volibear/config.yaml']);
    // toggle it back off — decision is reversible
    s = step(s, 'space');
    expect(s.selection.overwriteConfigPaths).toEqual([]);
    // toggle on again and continue to summary
    s = step(s, 'space');
    s = step(s, 'enter'); // -> summary
    expect(s.screen).toBe('summary');
  });

  it('supports different per-path config decisions in both scope (HIGH-1)', () => {
    const projectConfig = '/work/repo/.volibear/config.yaml';
    const globalConfig = '/home/alice/.volibear/config.yaml';
    let s = initialState(detections, [projectConfig, globalConfig], [], '/home/alice', '/work/repo');
    s = navigateTo(s, 'config-overwrite');
    expect(s.existingConfigPaths).toEqual([projectConfig, globalConfig]);
    // cursor 0: overwrite project config only
    s = step(s, 'space');
    expect(s.selection.overwriteConfigPaths).toEqual([projectConfig]);
    // cursor 1 (global config): keep it
    s = step(s, 'down');
    s = step(s, 'enter'); // -> summary
    expect(s.screen).toBe('summary');
    // decision preserved: only project config marked for overwrite
    expect(s.selection.overwriteConfigPaths).toEqual([projectConfig]);
  });

  it('handles existing bridge overwrite screen after config screen', () => {
    let s = initialState(
      detections,
      ['/work/repo/.volibear/config.yaml'],
      ['/work/repo/.claude/agents/volibear.md'],
      '/home/alice',
      '/work/repo',
    );
    s = navigateTo(s, 'bridge-overwrite');
    expect(s.screen).toBe('bridge-overwrite');
    // default: keep (overwriteIntegrationPaths empty)
    expect(s.selection.overwriteIntegrationPaths).toEqual([]);
    // toggle first bridge to overwrite
    s = step(s, 'space');
    expect(s.selection.overwriteIntegrationPaths).toEqual(['/work/repo/.claude/agents/volibear.md']);
  });

  it('bridge toggle is reversible: Space twice leaves the list empty (MED-2)', () => {
    const bridge = '/work/repo/.claude/agents/volibear.md';
    let s = initialState(detections, [], [bridge], '/home/alice', '/work/repo');
    s = navigateTo(s, 'bridge-overwrite');
    // marked item does NOT disappear from the list: cursor can still reach it
    s = step(s, 'space');
    expect(s.selection.overwriteIntegrationPaths).toEqual([bridge]);
    s = step(s, 'space');
    expect(s.selection.overwriteIntegrationPaths).toEqual([]);
  });

  it('selects two bridges for overwrite (MED-2)', () => {
    const bridgeA = '/work/repo/.claude/agents/volibear.md';
    const bridgeB = '/work/repo/.codex/agents/volibear.toml';
    let s = initialState(detections, [], [bridgeA, bridgeB], '/home/alice', '/work/repo');
    s = navigateTo(s, 'bridge-overwrite');
    // toggle bridgeA (cursor 0)
    s = step(s, 'space');
    expect(s.selection.overwriteIntegrationPaths).toEqual([bridgeA]);
    // move to bridgeB (cursor 1) and toggle it too
    s = step(s, 'down');
    s = step(s, 'space');
    expect(s.selection.overwriteIntegrationPaths).toEqual([bridgeA, bridgeB]);
    // cursor is bounded by the full list even with items marked (MED-2)
    const clamped = step(s, 'down');
    expect(clamped.cursor).toBe(1);
    s = clamped;
    s = step(s, 'enter'); // -> summary
    expect(s.screen).toBe('summary');
  });
});

describe('reduceWizardState with dynamic existing paths (MED-3)', () => {
  // Simulates a machine where only the global config and the Codex bridges
  // exist — no project config, no OpenCode/Claude bridges.
  const dynamicPaths: ExistingPathsFn = (scope, integrations) => {
    const scopes = scope === 'both' ? (['project', 'global'] as const) : ([scope] as const);
    const configs: string[] = [];
    const bridges: string[] = [];
    for (const sc of scopes) {
      if (sc === 'global') configs.push('/home/alice/.volibear/config.yaml');
      if (integrations.includes('codex')) {
        bridges.push(
          sc === 'project'
            ? '/work/repo/.codex/agents/volibear.toml'
            : '/home/alice/.codex/agents/volibear.toml',
        );
      }
    }
    return { configs, bridges };
  };

  it('recomputes existing paths when the scope changes', () => {
    let s = initialState(detections, [], [], '/home/alice', '/work/repo');
    s = step(s, 'enter'); // welcome -> detection
    s = step(s, 'enter'); // detection -> scope
    s = step(s, 'down'); // cursor 1 = global
    s = step(s, 'enter', dynamicPaths); // scope = global; paths refreshed
    expect(s.selection.scope).toBe('global');
    expect(s.existingConfigPaths).toEqual(['/home/alice/.volibear/config.yaml']);
    expect(s.existingIntegrationPaths).toEqual(['/home/alice/.codex/agents/volibear.toml']);
  });

  it('recomputes existing paths when integrations are toggled', () => {
    let s = initialState(detections, [], [], '/home/alice', '/work/repo');
    s = step(s, 'enter'); // welcome -> detection
    s = step(s, 'enter'); // detection -> scope
    s = step(s, 'enter', dynamicPaths); // scope = project
    // integrations screen: cursor 2 = codex, deselect it
    s = step(s, 'down');
    s = step(s, 'down');
    s = step(s, 'space', dynamicPaths);
    expect(s.selection.integrations).toEqual(['opencode']);
    expect(s.existingIntegrationPaths).toEqual([]);
    expect(s.existingConfigPaths).toEqual([]);
  });

  it('does not prompt for scopes/integrations that were not selected (MED-3)', () => {
    // Selection: project scope, codex deselected → neither the global config
    // nor the Codex bridge prompts may appear.
    let s = initialState(detections, [], [], '/home/alice', '/work/repo');
    s = step(s, 'enter'); // welcome -> detection
    s = step(s, 'enter'); // detection -> scope
    s = step(s, 'enter', dynamicPaths); // scope = project
    s = step(s, 'down');
    s = step(s, 'down');
    s = step(s, 'space', dynamicPaths); // deselect codex
    s = step(s, 'enter', dynamicPaths); // -> pipelines
    s = step(s, 'enter'); // -> executor
    s = step(s, 'enter'); // -> router
    const after = step(s, 'enter'); // router -> must go straight to summary
    expect(after.screen).toBe('summary');
  });

  it('prunes overwrite decisions for paths that stop being relevant', () => {
    let s = initialState(detections, [], [], '/home/alice', '/work/repo');
    s = step(s, 'enter'); // welcome -> detection
    s = step(s, 'enter'); // detection -> scope
    s = step(s, 'enter', dynamicPaths); // scope = project
    s = step(s, 'enter', dynamicPaths); // integrations -> pipelines
    s = step(s, 'enter'); // -> executor
    s = step(s, 'enter'); // -> router
    s = step(s, 'enter', dynamicPaths); // -> bridge-overwrite (codex bridge exists)
    expect(s.screen).toBe('bridge-overwrite');
    // Mark the codex bridge for overwrite.
    s = step(s, 'space');
    expect(s.selection.overwriteIntegrationPaths).toEqual(['/work/repo/.codex/agents/volibear.toml']);
    // Walk back to the integrations screen (bridge-overwrite → router → executor → pipelines → integrations).
    s = step(s, 'escape', dynamicPaths); // -> router
    s = step(s, 'escape'); // -> executor
    s = step(s, 'escape'); // -> pipelines
    s = step(s, 'escape'); // -> integrations
    // Deselect codex: the stale overwrite decision must be pruned (MED-3).
    s = step(s, 'down');
    s = step(s, 'down');
    s = step(s, 'space', dynamicPaths);
    expect(s.selection.integrations).toEqual(['opencode']);
    expect(s.selection.overwriteIntegrationPaths).toEqual([]);
    expect(s.existingIntegrationPaths).toEqual([]);
    // Reselect codex: the bridge is offered again, but the decision stays cleared.
    s = step(s, 'space', dynamicPaths);
    expect(s.selection.integrations).toEqual(['opencode', 'codex']);
    expect(s.existingIntegrationPaths).toEqual(['/work/repo/.codex/agents/volibear.toml']);
    expect(s.selection.overwriteIntegrationPaths).toEqual([]);
  });
});
