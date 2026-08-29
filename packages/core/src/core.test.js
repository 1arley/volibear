import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveProjectDir } from './config.js';
import { EventLog } from './events.js';
import { ArtifactStore } from './artifacts.js';
import { RunStore } from './state.js';
function tempDir() {
    return mkdtempSync(join(tmpdir(), 'volibear-core-'));
}
describe('config loader', () => {
    it('applies precedence: defaults < global < project < overrides', () => {
        const dir = tempDir();
        const projectDir = join(dir, 'project', '.volibear');
        const globalDir = join(dir, 'global');
        // Global config: set default executor to 'opencode'
        mkdirSync(globalDir, { recursive: true });
        writeFileSync(join(globalDir, 'config.yaml'), 'executor: opencode\nrouter:\n  mode: native\n');
        // Project config: override executor to 'codex'
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(join(projectDir, 'config.yaml'), 'executor: codex\n');
        const config = loadConfig({
            projectDir,
            globalDir,
            overrides: { executor: 'claude' },
        });
        // CLI override wins
        expect(config.executor).toBe('claude');
        const noOverride = loadConfig({ projectDir, globalDir });
        // Project config wins over global
        expect(noOverride.executor).toBe('codex');
    });
    it('returns defaults when no config files exist', () => {
        const dir = tempDir();
        const config = loadConfig({
            projectDir: join(dir, 'nonexistent', '.volibear'),
            globalDir: join(dir, 'nonexistent-global'),
        });
        expect(config.executor).toBe('mock');
        expect(config.pipeline).toBe('feature');
        expect(config.repair.max_cycles).toBe(3);
        expect(config.repair.reject_on).toEqual(['critical', 'high']);
    });
    it('resolveProjectDir points to .volibear in cwd', () => {
        expect(resolveProjectDir('/tmp/someproject')).toBe('/tmp/someproject/.volibear');
    });
});
describe('event log', () => {
    let dir;
    let log;
    beforeEach(() => {
        dir = tempDir();
        log = new EventLog(dir);
    });
    it('records and persists events', () => {
        log.record('run.started', 'run-1', { task: 'x' });
        log.record('requirements.locked', 'run-1', { version: 1 });
        const all = log.all();
        expect(all).toHaveLength(2);
        expect(all[0].event).toBe('run.started');
        expect(all[1].event).toBe('requirements.locked');
        // Persisted to disk
        const file = readFileSync(join(dir, 'events.jsonl'), 'utf-8');
        const lines = file.trim().split('\n');
        expect(lines).toHaveLength(2);
    });
    it('reloads existing events on new instance (resume support)', () => {
        log.record('run.started', 'run-1');
        const reloaded = new EventLog(dir);
        expect(reloaded.all()).toHaveLength(1);
        expect(reloaded.last('run.started')?.run_id).toBe('run-1');
    });
    it('filters by event type', () => {
        log.record('stage.started', 'run-1', { stage: 'architect' });
        log.record('stage.completed', 'run-1', { stage: 'architect' });
        log.record('run.completed', 'run-1', { status: 'pass' });
        expect(log.filter('stage.completed')).toHaveLength(1);
        expect(log.filter('stage.started')).toHaveLength(1);
    });
});
describe('artifact store', () => {
    let dir;
    let store;
    beforeEach(() => {
        dir = tempDir();
        store = new ArtifactStore(dir);
    });
    it('writes and reads structured artifacts', () => {
        const path = store.write('requirements', { version: 1, task: 't', decisions: [] });
        expect(existsSync(path)).toBe(true);
        const read = store.read('requirements');
        expect(read?.version).toBe(1);
    });
    it('returns null for missing artifacts', () => {
        expect(store.exists('architecture')).toBe(false);
        expect(store.read('architecture')).toBeNull();
    });
    it('writes and reads raw files', () => {
        store.writeRaw('architecture.md', '# Architecture');
        expect(store.readRaw('architecture.md')).toBe('# Architecture');
    });
});
describe('run store', () => {
    let dir;
    let store;
    beforeEach(() => {
        dir = tempDir();
        store = new RunStore(dir);
    });
    it('creates, persists, and loads a run', () => {
        const run = store.create('01RUN', 'feature', 'implement feature X');
        expect(run.state).toBe('CREATED');
        expect(run.task).toBe('implement feature X');
        const loaded = store.load('01RUN');
        expect(loaded?.state).toBe('CREATED');
        expect(loaded?.id).toBe('01RUN');
    });
    it('updates run state', () => {
        store.create('01RUN', 'feature', 'task');
        const updated = store.update('01RUN', { state: 'DISCOVERY' });
        expect(updated?.state).toBe('DISCOVERY');
        const loaded = store.load('01RUN');
        expect(loaded?.state).toBe('DISCOVERY');
    });
    it('lists runs sorted by creation', () => {
        store.create('01RUN', 'feature', 'first');
        store.create('02RUN', 'feature', 'second');
        const runs = store.list();
        expect(runs).toHaveLength(2);
    });
    it('returns latest run', () => {
        store.create('01RUN', 'feature', 'first');
        store.create('02RUN', 'feature', 'second');
        expect(store.latest()?.id).toBe('02RUN');
    });
    it('returns null for missing run', () => {
        expect(store.load('missing')).toBeNull();
    });
});
//# sourceMappingURL=core.test.js.map