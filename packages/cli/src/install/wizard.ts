/**
 * Interactive TUI wizard for `volibear install`.
 *
 * Uses only Node built-in readline with raw mode — no runtime dependencies.
 *
 * Navigation:
 *   ↑/↓        move cursor
 *   Space      toggle multi-select
 *   Enter      confirm / advance
 *   Esc        go back or cancel
 *   Ctrl+C     cancel
 */
import readline from 'node:readline';
import { detectIntegrations, detectedIntegrationIds } from './detection.js';
import { getHomeDir, displayPath, computeExistingPaths } from './paths.js';
import { getIntegration } from './integrations/index.js';
import { existsSync } from 'node:fs';
import type { DetectedIntegration, IntegrationId, InstallPipeline, InstallExecutor, RouterMode, InstallScope } from './types.js';

// ── Types ───────────────────────────────────────────────

/** Minimal stdin surface the wizard needs (structural, test-friendly). */
export interface WizardStdin {
  isRaw?: boolean;
  on(
    event: string,
    listener: (chunk: unknown, key?: { name?: string; ctrl?: boolean }) => void,
  ): unknown;
  removeListener(
    event: string,
    listener: (chunk: unknown, key?: { name?: string; ctrl?: boolean }) => void,
  ): unknown;
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
}

/**
 * Computes which install paths already exist for a given scope + integration
 * selection. The wizard re-queries this after every scope/integration change
 * so overwrite prompts only cover files the current selection would touch.
 */
export type ExistingPathsFn = (
  scope: InstallScope,
  integrations: IntegrationId[],
) => { configs: string[]; bridges: string[] };

export interface WizardDependencies {
  write(text: string): void;
  clear(): void;
  stdin: WizardStdin;
  stdout: NodeJS.WriteStream;
  exists(path: string): boolean;
  detectIntegrations(): DetectedIntegration[];
  existingPaths: ExistingPathsFn;
}

export interface WizardSelection {
  scope: InstallScope;
  integrations: IntegrationId[];
  pipelines: InstallPipeline[];
  executor: InstallExecutor;
  router: RouterMode;
  /** Existing config files the user chose to overwrite (per-path, HIGH-1). */
  overwriteConfigPaths: string[];
  /** Existing bridge files the user chose to overwrite (per-path). */
  overwriteIntegrationPaths: string[];
}

export type WizardOutcome =
  | { kind: 'confirmed'; selection: WizardSelection }
  | { kind: 'cancelled' };

export type WizardKey = 'up' | 'down' | 'space' | 'enter' | 'escape' | 'ctrl-c';

export type WizardScreenId =
  | 'welcome'
  | 'detection'
  | 'scope'
  | 'integrations'
  | 'pipelines'
  | 'executor'
  | 'router'
  | 'config-overwrite'
  | 'bridge-overwrite'
  | 'summary';

export interface WizardState {
  screen: WizardScreenId;
  cursor: number;
  selection: WizardSelection;
  history: WizardScreenId[];
  errors: string[];
  detections: DetectedIntegration[];
  existingConfigPaths: string[];
  existingIntegrationPaths: string[];
  homeDir: string;
  cwd: string;
}

// ── Wizard options ──────────────────────────────────────

const SCOPE_OPTIONS: InstallScope[] = ['project', 'global', 'both'];
const INTEGRATION_LIST: IntegrationId[] = ['opencode', 'claude', 'codex'];
const PIPELINE_OPTIONS: InstallPipeline[] = ['feature', 'fix'];
const EXECUTOR_OPTIONS: InstallExecutor[] = ['mock', 'opencode', 'codex', 'claude'];
const ROUTER_OPTIONS: RouterMode[] = ['native', '9router'];

// ── State reducer (pure, testable) ──────────────────────

export function initialState(
  detections: DetectedIntegration[],
  existingConfigPaths: string[],
  existingIntegrationPaths: string[],
  homeDir: string,
  cwd: string,
): WizardState {
  return {
    screen: 'welcome',
    cursor: 0,
    selection: {
      scope: 'project',
      integrations: detectedIntegrationIds(detections),
      pipelines: ['feature', 'fix'],
      executor: 'mock',
      router: 'native',
      overwriteConfigPaths: [],
      overwriteIntegrationPaths: [],
    },
    history: [],
    errors: [],
    detections,
    existingConfigPaths,
    existingIntegrationPaths,
    homeDir,
    cwd,
  };
}

/**
 * Recompute the relevant existing paths from the current selection and drop
 * stale overwrite decisions that no longer match those paths. Invoked after
 * every scope or integration change so overwrite prompts only ever cover
 * files the current selection would actually touch (MED-3).
 */
function refreshExistingPaths(state: WizardState, existingPaths?: ExistingPathsFn): void {
  if (!existingPaths) return;
  const existing = existingPaths(state.selection.scope, state.selection.integrations);
  state.existingConfigPaths = existing.configs;
  state.existingIntegrationPaths = existing.bridges;
  state.selection.overwriteConfigPaths = state.selection.overwriteConfigPaths.filter((p) =>
    existing.configs.includes(p),
  );
  state.selection.overwriteIntegrationPaths = state.selection.overwriteIntegrationPaths.filter((p) =>
    existing.bridges.includes(p),
  );
}

export function reduceWizardState(
  state: WizardState,
  key: WizardKey,
  existingPaths?: ExistingPathsFn,
): WizardState | { outcome: WizardOutcome } {
  if (key === 'ctrl-c') {
    return { outcome: { kind: 'cancelled' } };
  }

  const clone = (): WizardState => JSON.parse(JSON.stringify(state)) as WizardState;

  switch (state.screen) {
    case 'welcome': {
      if (key === 'enter') return advance(clone(), 'detection');
      if (key === 'escape') return { outcome: { kind: 'cancelled' } };
      return state;
    }

    case 'detection': {
      if (key === 'enter') return advance(clone(), 'scope');
      if (key === 'escape') return back(clone(), 'welcome');
      return state;
    }

    case 'scope': {
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(SCOPE_OPTIONS.length - 1, state.cursor + 1) };
      if (key === 'enter') {
        const next = clone();
        next.selection.scope = SCOPE_OPTIONS[next.cursor];
        next.cursor = 0;
        refreshExistingPaths(next, existingPaths);
        return advance(next, 'integrations');
      }
      if (key === 'escape') return back(clone(), 'detection');
      return state;
    }

    case 'integrations': {
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(INTEGRATION_LIST.length - 1, state.cursor + 1) };
      if (key === 'space') {
        const next = clone();
        const id = INTEGRATION_LIST[next.cursor];
        const idx = next.selection.integrations.indexOf(id);
        if (idx >= 0) {
          next.selection.integrations.splice(idx, 1);
        } else {
          next.selection.integrations.push(id);
        }
        refreshExistingPaths(next, existingPaths);
        return next;
      }
      if (key === 'enter') {
        const next = clone();
        next.cursor = 0;
        refreshExistingPaths(next, existingPaths);
        return advance(next, 'pipelines');
      }
      if (key === 'escape') return back(clone(), 'scope');
      return state;
    }

    case 'pipelines': {
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(PIPELINE_OPTIONS.length - 1, state.cursor + 1) };
      if (key === 'space') {
        const next = clone();
        const p = PIPELINE_OPTIONS[next.cursor];
        const idx = next.selection.pipelines.indexOf(p);
        if (idx >= 0) {
          next.selection.pipelines.splice(idx, 1);
        } else {
          next.selection.pipelines.push(p);
        }
        next.errors = next.selection.pipelines.length === 0 ? ['Select at least one pipeline.'] : [];
        return next;
      }
      if (key === 'enter') {
        if (state.selection.pipelines.length === 0) {
          return { ...clone(), errors: ['Select at least one pipeline.'] };
        }
        const next = clone();
        next.cursor = 0;
        next.errors = [];
        return advance(next, 'executor');
      }
      if (key === 'escape') return back(clone(), 'integrations');
      return state;
    }

    case 'executor': {
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(EXECUTOR_OPTIONS.length - 1, state.cursor + 1) };
      if (key === 'enter') {
        const next = clone();
        next.selection.executor = EXECUTOR_OPTIONS[next.cursor];
        next.cursor = 0;
        return advance(next, 'router');
      }
      if (key === 'escape') return back(clone(), 'pipelines');
      return state;
    }

    case 'router': {
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(ROUTER_OPTIONS.length - 1, state.cursor + 1) };
      if (key === 'enter') {
        const next = clone();
        next.selection.router = ROUTER_OPTIONS[next.cursor];
        next.cursor = 0;
        // Decide next screen based on whether there are existing configs or bridges
        if (next.existingConfigPaths.length > 0) {
          return advance(next, 'config-overwrite');
        }
        if (next.existingIntegrationPaths.length > 0) {
          return advance(next, 'bridge-overwrite');
        }
        return advance(next, 'summary');
      }
      if (key === 'escape') return back(clone(), 'executor');
      return state;
    }

    case 'config-overwrite': {
      const items = state.existingConfigPaths;
      if (items.length === 0) {
        const next = clone();
        next.cursor = 0;
        if (next.existingIntegrationPaths.length > 0) {
          return advance(next, 'bridge-overwrite');
        }
        return advance(next, 'summary');
      }
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(items.length - 1, state.cursor + 1) };
      if (key === 'space') {
        const next = clone();
        const path = items[next.cursor];
        const idx = next.selection.overwriteConfigPaths.indexOf(path);
        if (idx >= 0) {
          next.selection.overwriteConfigPaths.splice(idx, 1);
        } else {
          next.selection.overwriteConfigPaths.push(path);
        }
        return next;
      }
      if (key === 'enter') {
        const next = clone();
        next.cursor = 0;
        if (next.existingIntegrationPaths.length > 0) {
          return advance(next, 'bridge-overwrite');
        }
        return advance(next, 'summary');
      }
      if (key === 'escape') return back(clone(), 'router');
      return state;
    }

    case 'bridge-overwrite': {
      // Every existing bridge stays listed and toggleable (MED-2): a marked
      // item must remain visible so the user can undo the decision.
      const items = state.existingIntegrationPaths;
      if (items.length === 0) {
        const next = clone();
        next.cursor = 0;
        return advance(next, 'summary');
      }
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(items.length - 1, state.cursor + 1) };
      if (key === 'space') {
        const next = clone();
        const path = items[next.cursor];
        const idx = next.selection.overwriteIntegrationPaths.indexOf(path);
        if (idx >= 0) {
          next.selection.overwriteIntegrationPaths.splice(idx, 1);
        } else {
          next.selection.overwriteIntegrationPaths.push(path);
        }
        return next;
      }
      if (key === 'enter') {
        const next = clone();
        next.cursor = 0;
        return advance(next, 'summary');
      }
      if (key === 'escape') {
        const prev = state.existingConfigPaths.length > 0 ? 'config-overwrite' : 'router';
        return back(clone(), prev);
      }
      return state;
    }

    case 'summary': {
      if (key === 'enter') {
        if (state.cursor === 0) {
          // Confirm
          return { outcome: { kind: 'confirmed', selection: state.selection } };
        }
        // Cancel by selecting "Cancel"
        return { outcome: { kind: 'cancelled' } };
      }
      if (key === 'up') return { ...clone(), cursor: Math.max(0, state.cursor - 1) };
      if (key === 'down') return { ...clone(), cursor: Math.min(1, state.cursor + 1) };
      if (key === 'escape') {
        // Go back to the last decision screen
        const prev = state.existingIntegrationPaths.length > 0
          ? 'bridge-overwrite'
          : state.existingConfigPaths.length > 0
            ? 'config-overwrite'
            : 'router';
        return back(clone(), prev);
      }
      return state;
    }
  }

  return state;
}

function advance(state: WizardState, screen: WizardScreenId): WizardState {
  state.history.push(state.screen);
  state.screen = screen;
  state.cursor = 0;
  return state;
}

function back(state: WizardState, screen: WizardScreenId): WizardState {
  state.history.pop();
  state.screen = screen;
  state.cursor = 0;
  return state;
}

// ── Terminal renderer ───────────────────────────────────

const CLEAR = '\x1B[2J\x1B[3J\x1B[H';
const HIDE_CURSOR = '\x1B[?25l';
const SHOW_CURSOR = '\x1B[?25h';
const RESET = '\x1B[0m';
const BOLD = '\x1B[1m';
const GREEN = '\x1B[32m';
const YELLOW = '\x1B[33m';
const RED = '\x1B[31m';
const DIM = '\x1B[2m';

function render(state: WizardState): string {
  const lines: string[] = [];

  const header = () => lines.push(`${BOLD}Volibear Installation${RESET}\n`);

  switch (state.screen) {
    case 'welcome':
      header();
      lines.push('Welcome to Volibear — portable multi-agent pipeline runtime.');
      lines.push('');
      lines.push('This installs the Volibear runtime config (.volibear/) and');
      lines.push('optional native bridge agents for coding CLIs.');
      lines.push('');
      lines.push('Native agents are NOT replaced. The bridge only delegates to');
      lines.push('`volibear build` and `volibear fix` runtime commands.');
      lines.push('');
      lines.push(`${DIM}${'> Press Enter to continue, Esc to cancel'}${RESET}`);
      break;

    case 'detection':
      header();
      lines.push('Detected coding CLIs on PATH:\n');
      for (const d of state.detections) {
        const lbl = getIntegration(d.id).label;
        if (d.available) {
          lines.push(`  ${GREEN}✓ ${lbl}${RESET}`);
        } else {
          lines.push(`  ${DIM}○ ${lbl} not found${RESET}`);
        }
      }
      if (state.detections.every(d => !d.available)) {
        lines.push('');
        lines.push(`${YELLOW}No supported coding CLI was found on PATH.${RESET}`);
        lines.push('You can still install bridge files for a CLI you install later.');
      }
      lines.push('');
      lines.push(`${DIM}> Press Enter to continue, Esc to go back${RESET}`);
      break;

    case 'scope': {
      const items = SCOPE_OPTIONS;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const selected = items[i] === state.selection.scope ? '●' : '○';
        lines.push(` ${prefix} ${selected} ${items[i].charAt(0).toUpperCase() + items[i].slice(1)}`);
      }
      break;
    }

    case 'integrations': {
      const items = INTEGRATION_LIST;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const checked = state.selection.integrations.includes(items[i]) ? '[x]' : '[ ]';
        const det = state.detections.find(d => d.id === items[i]);
        const status = det?.available ? `${GREEN}detected${RESET}` : `${DIM}not found${RESET}`;
        lines.push(` ${prefix} ${checked} ${getIntegration(items[i]).label}  ${status}`);
      }
      lines.push('');
      lines.push(`${DIM}Space: toggle  Enter: continue  Esc: back${RESET}`);
      break;
    }

    case 'pipelines': {
      const items = PIPELINE_OPTIONS;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const checked = state.selection.pipelines.includes(items[i]) ? '[x]' : '[ ]';
        lines.push(` ${prefix} ${checked} ${items[i]}.yaml`);
      }
      if (state.errors.length > 0) {
        lines.push(`\n${RED}${state.errors[0]}${RESET}`);
      }
      lines.push('');
      lines.push(`${DIM}Space: toggle  Enter: continue  Esc: back${RESET}`);
      break;
    }

    case 'executor': {
      const items = EXECUTOR_OPTIONS;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const selected = items[i] === state.selection.executor ? '●' : '○';
        lines.push(` ${prefix} ${selected} ${items[i]}`);
      }
      lines.push('');
      lines.push(`${DIM}↑/↓: move  Enter: select  Esc: back${RESET}`);
      break;
    }

    case 'router': {
      const items = ROUTER_OPTIONS;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const selected = items[i] === state.selection.router ? '●' : '○';
        lines.push(` ${prefix} ${selected} ${items[i]}`);
      }
      lines.push('');
      lines.push(`${DIM}↑/↓: move  Enter: select  Esc: back${RESET}`);
      break;
    }

    case 'config-overwrite': {
      lines.push('Existing Volibear configuration\n');
      const items = state.existingConfigPaths;
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const checked = state.selection.overwriteConfigPaths.includes(items[i]) ? '[x]' : '[ ]';
        lines.push(` ${prefix} ${checked} Overwrite ${displayPath(items[i], state.homeDir)}`);
      }
      lines.push('');
      lines.push(`${DIM}Space: toggle  Enter: continue  Esc: back${RESET}`);
      break;
    }

    case 'bridge-overwrite': {
      const items = state.existingIntegrationPaths;
      if (items.length === 0) break;
      lines.push('Existing Volibear bridge agents\n');
      for (let i = 0; i < items.length; i++) {
        const prefix = i === state.cursor ? '>' : ' ';
        const checked = state.selection.overwriteIntegrationPaths.includes(items[i]) ? '[x]' : '[ ]';
        lines.push(` ${prefix} ${checked} Overwrite ${displayPath(items[i], state.homeDir)}`);
      }
      lines.push('');
      lines.push(`${DIM}Space: toggle  Enter: continue  Esc: back${RESET}`);
      break;
    }

    case 'summary': {
      lines.push('Installation summary\n');
      const s = state.selection;
      const row = (label: string, value: string) => `  ${label.padEnd(20)}${value}`;
      lines.push(row('Scope', s.scope === 'both' ? 'Project + Global' : s.scope.charAt(0).toUpperCase() + s.scope.slice(1)));
      lines.push(row('CLI bridges', s.integrations.length === 0 ? '(none)' : s.integrations.map(i => getIntegration(i).label).join(', ')));
      lines.push(row('Pipelines', s.pipelines.join(', ')));
      lines.push(row('Executor', s.executor));
      lines.push(row('Router', s.router));
      lines.push('');
      if (state.existingConfigPaths.length > 0) {
        const overwritten = state.existingConfigPaths.filter(p => s.overwriteConfigPaths.includes(p));
        const kept = state.existingConfigPaths.filter(p => !s.overwriteConfigPaths.includes(p));
        if (kept.length > 0) lines.push(row('Kept configs', kept.map(p => displayPath(p, state.homeDir)).join(', ')));
        if (overwritten.length > 0) lines.push(row('Overwritten configs', overwritten.map(p => displayPath(p, state.homeDir)).join(', ')));
      }
      if (state.existingIntegrationPaths.length > 0) {
        const overwritten = state.existingIntegrationPaths.filter(p => s.overwriteIntegrationPaths.includes(p));
        const kept = state.existingIntegrationPaths.filter(p => !s.overwriteIntegrationPaths.includes(p));
        if (kept.length > 0) lines.push(row('Kept bridges', kept.map(p => displayPath(p, state.homeDir)).join(', ')));
        if (overwritten.length > 0) lines.push(row('Overwritten bridges', overwritten.map(p => displayPath(p, state.homeDir)).join(', ')));
      }
      lines.push('');
      lines.push(` ${state.cursor === 0 ? '>' : ' '} Confirm installation`);
      lines.push(` ${state.cursor === 1 ? '>' : ' '} Cancel`);
      break;
    }
  }

  return lines.join('\n');
}

// ── Default dependencies ────────────────────────────────

function defaultDeps(): WizardDependencies {
  const exists = (p: string) => existsSync(p);
  return {
    write: (text) => process.stdout.write(text),
    clear: () => { /* no-op, render handles full clear */ },
    stdin: process.stdin,
    stdout: process.stdout,
    exists,
    detectIntegrations: () => detectIntegrations(),
    existingPaths: (scope, integrations) =>
      computeExistingPaths(scope, integrations, {
        cwd: process.cwd(),
        homeDir: safeHomeDir(),
      }, exists),
  };
}

function safeHomeDir(): string {
  try { return getHomeDir(); } catch { return ''; }
}

// ── Main wizard entry point ─────────────────────────────

/**
 * Run the interactive install wizard.
 *
 * `existingPaths` (either injected or the default derived from `exists`)
 * is consulted dynamically after every scope/integration change, so the
 * config/bridge overwrite screens only ever cover files the current
 * selection would actually touch (MED-3).
 */
export async function runInstallWizard(
  detections?: DetectedIntegration[],
  deps?: Partial<WizardDependencies>,
): Promise<WizardOutcome> {
  const d: WizardDependencies = { ...defaultDeps(), ...deps };
  // When the caller injected `exists` but not `existingPaths`, rebuild the
  // default existingPaths on top of the injected predicate.
  if (!deps?.existingPaths) {
    d.existingPaths = (scope, integrations) =>
      computeExistingPaths(scope, integrations, {
        cwd: process.cwd(),
        homeDir: safeHomeDir(),
      }, d.exists);
  }
  const actualDetections = detections ?? d.detectIntegrations();
  const homeDir = safeHomeDir();

  let state = initialState(actualDetections, [], [], homeDir, process.cwd());
  const initial = d.existingPaths(state.selection.scope, state.selection.integrations);
  state = { ...state, existingConfigPaths: initial.configs, existingIntegrationPaths: initial.bridges };

  // Create cleanup BEFORE mutating the stream (MED-5): if any setup step
  // throws, the finally-style catch below can still restore raw mode,
  // unpause and re-show the cursor.
  const originalRaw = d.stdin.isRaw;
  const cleanup = () => {
    setRawModeGuarded(d.stdin, originalRaw ?? false);
    d.stdin.pause();
    d.write(SHOW_CURSOR);
  };

  try {
    // Setup raw mode (guarded so injected streams used in tests work too).
    readline.emitKeypressEvents(d.stdin as NodeJS.ReadStream);
    setRawModeGuarded(d.stdin, true);
    d.stdin.resume();
    d.write(HIDE_CURSOR);

    return await new Promise<WizardOutcome>((resolve) => {
      const onKeypress = (_chunk: unknown, key?: { name?: string; ctrl?: boolean }) => {
        const k = key ?? {};
        let mapped: WizardKey | undefined;

        if (k.ctrl && k.name === 'c') {
          mapped = 'ctrl-c';
        } else if (k.name === 'up' || k.name === 'k') {
          mapped = 'up';
        } else if (k.name === 'down' || k.name === 'j') {
          mapped = 'down';
        } else if (k.name === 'space') {
          mapped = 'space';
        } else if (k.name === 'return' || k.name === 'enter') {
          mapped = 'enter';
        } else if (k.name === 'escape') {
          mapped = 'escape';
        }

        if (mapped === undefined) return;

        const result = reduceWizardState(state, mapped, d.existingPaths);

        if ('outcome' in result) {
          d.stdin.removeListener('keypress', onKeypress);
          cleanup();
          d.write(CLEAR);
          resolve(result.outcome);
          return;
        }

        state = result;
        renderScreen(state, d);
      };

      d.stdin.on('keypress', onKeypress);
      renderScreen(state, d);
    });
  } catch (err) {
    cleanup();
    throw err;
  }
}

function renderScreen(state: WizardState, deps: WizardDependencies): void {
  const content = render(state);
  // Clear and redraw
  deps.write(CLEAR);
  deps.write(content);
}

/** Call setRawMode when the (possibly injected) stream supports it. */
function setRawModeGuarded(stdin: WizardStdin, mode: boolean): void {
  if (typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(mode);
  }
}