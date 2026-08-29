import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlockingQuestionsResolvedGate, NoFindingsAboveThresholdGate, RepairCyclesWithinLimitGate, } from './gates.js';
import { RubberduckSession } from './rubberduck.js';
import { MockExecutor, MockRubberduckDriver } from '@volibear/executors';
import { BUILTIN_AGENTS, } from '@volibear/contracts';
import { EventLog, ArtifactStore, RunStore } from '@volibear/core';
import { RunOrchestrator } from './orchestrator.js';
import { PipelineParser, validatePipelineAgents } from './pipeline.js';
function tempDir() {
    return mkdtempSync(join(tmpdir(), 'volibear-runtime-'));
}
// ── Gate tests ─────────────────────────────────────────
describe('BlockingQuestionsResolvedGate', () => {
    const gate = new BlockingQuestionsResolvedGate();
    it('passes when no unresolved blocking questions', () => {
        const r = gate.evaluate({
            requirements: {
                version: 1,
                task: 'test',
                decisions: [],
                assumptions: [],
                constraints: [],
                acceptance_intent: [],
                unresolved: [],
            },
        });
        expect(r.passed).toBe(true);
    });
    it('fails when blocking questions remain', () => {
        const r = gate.evaluate({
            requirements: {
                version: 1,
                task: 'test',
                decisions: [],
                assumptions: [],
                constraints: [],
                acceptance_intent: [],
                unresolved: [
                    { id: 'Q1', question: 'x', type: 'BLOCKING' },
                    { id: 'Q2', question: 'y', type: 'BLOCKING' },
                ],
            },
        });
        expect(r.passed).toBe(false);
        expect(r.reason).toContain('2 blocking');
    });
    it('passes when only optional questions are unresolved', () => {
        const r = gate.evaluate({
            requirements: {
                version: 1,
                task: 'test',
                decisions: [],
                assumptions: [],
                constraints: [],
                acceptance_intent: [],
                unresolved: [
                    { id: 'Q1', question: 'x', type: 'OPTIONAL' },
                ],
            },
        });
        expect(r.passed).toBe(true);
    });
});
describe('NoFindingsAboveThresholdGate', () => {
    const gate = new NoFindingsAboveThresholdGate();
    it('passes with empty findings', () => {
        const r = gate.evaluate({
            review: { version: 1, approved: true, findings: [] },
            rejectOn: ['critical', 'high'],
        });
        expect(r.passed).toBe(true);
    });
    it('fails when high findings exist', () => {
        const r = gate.evaluate({
            review: {
                version: 1,
                approved: false,
                findings: [
                    { id: 'F1', severity: 'high', title: 'X' },
                    { id: 'F2', severity: 'info', title: 'Y' },
                ],
            },
            rejectOn: ['critical', 'high'],
        });
        expect(r.passed).toBe(false);
        expect(r.details?.rejected).toHaveLength(1);
    });
    it('passes with low/medium findings when threshold is high', () => {
        const r = gate.evaluate({
            review: {
                version: 1,
                approved: true,
                findings: [
                    { id: 'F1', severity: 'medium', title: 'X' },
                    { id: 'F2', severity: 'low', title: 'Y' },
                ],
            },
            rejectOn: ['critical', 'high'],
        });
        expect(r.passed).toBe(true);
    });
});
describe('RepairCyclesWithinLimitGate', () => {
    const gate = new RepairCyclesWithinLimitGate();
    it('passes when within limit', () => {
        const r = gate.evaluate({ repairCycle: 2, maxRepairCycles: 3 });
        expect(r.passed).toBe(true);
    });
    it('fails when exceeded', () => {
        const r = gate.evaluate({ repairCycle: 4, maxRepairCycles: 3 });
        expect(r.passed).toBe(false);
    });
});
// ── Rubberduck state machine tests ─────────────────────
describe('RubberduckSession', () => {
    let dir;
    let events;
    let artifacts;
    let driver;
    beforeEach(() => {
        dir = tempDir();
        events = new EventLog(dir);
        artifacts = new ArtifactStore(dir);
        driver = new MockRubberduckDriver();
    });
    it('goes through full state machine: DISCOVERING → QUESTIONS_PENDING → REVIEW → LOCKED', async () => {
        const session = new RubberduckSession('run-1', driver, events, artifacts, 'test task');
        expect(session.getState()).toBe('DISCOVERING');
        const questions = await session.discover();
        expect(session.getState()).toBe('QUESTIONS_PENDING');
        expect(questions.length).toBeGreaterThan(0);
        // Answer all BLOCKING questions
        const blocking = session.blockingUnresolved();
        for (const q of blocking) {
            await session.delegate(q.id);
        }
        expect(session.getState()).toBe('REVIEW');
        const req = await session.lock();
        expect(session.getState()).toBe('LOCKED');
        expect(req.version).toBe(1);
        expect(req.unresolved).toHaveLength(0);
    });
    it('refuses to lock while blocking questions are unanswered', async () => {
        const driver2 = new MockRubberduckDriver({
            blockingQuestions: ['Q-A', 'Q-B', 'Q-C'],
        });
        const session = new RubberduckSession('run-2', driver2, events, artifacts, 'task');
        await session.discover();
        expect(session.getState()).toBe('QUESTIONS_PENDING');
        // Answer only 1 of 3 blocking
        const blocking = session.blockingUnresolved();
        await session.delegate(blocking[0].id);
        expect(session.getState()).toBe('ANSWERS_INCOMPLETE');
        expect(session.blockingUnresolved().length).toBe(2);
        // lock() should throw — core strictness rule
        await expect(session.lock()).rejects.toThrow('blocking question(s) remain');
        expect(session.getState()).not.toBe('LOCKED');
    });
    it('tracks question types correctly', async () => {
        const driver2 = new MockRubberduckDriver({
            blockingQuestions: ['B1'],
            optionalQuestions: ['O1'],
            inferableQuestions: ['I1'],
        });
        const session = new RubberduckSession('run-3', driver2, events, artifacts, 'task');
        const questions = await session.discover();
        expect(questions.filter((q) => q.type === 'BLOCKING')).toHaveLength(1);
        expect(questions.filter((q) => q.type === 'OPTIONAL')).toHaveLength(1);
        expect(questions.filter((q) => q.type === 'INFERABLE')).toHaveLength(1);
    });
    it('produces structured requirements after lock', async () => {
        const session = new RubberduckSession('run-4', driver, events, artifacts, 'task');
        await session.discover();
        for (const q of session.blockingUnresolved()) {
            await session.delegate(q.id);
        }
        const req = await session.lock();
        expect(req.task).toBe('task');
        expect(req.decisions.length).toBeGreaterThan(0);
        expect(req.decisions[0].answer_source).toBe('delegated');
        expect(req.decisions[0].approved_by_user).toBe(true);
    });
    it('records all required events', async () => {
        const session = new RubberduckSession('run-5', driver, events, artifacts, 'task');
        await session.discover();
        for (const q of session.blockingUnresolved()) {
            await session.delegate(q.id);
        }
        await session.lock();
        expect(events.filter('rubberduck.question.created').length).toBeGreaterThan(0);
        expect(events.filter('rubberduck.question.answered').length).toBeGreaterThan(0);
        expect(events.filter('rubberduck.state.changed').length).toBeGreaterThan(0);
        expect(events.filter('requirements.locked').length).toBe(1);
    });
    it('rejects illegal state transitions', async () => {
        const session = new RubberduckSession('run-6', driver, events, artifacts, 'task');
        await session.discover();
        for (const q of session.blockingUnresolved()) {
            await session.delegate(q.id);
        }
        await session.lock();
        // Cannot discover again
        await expect(session.discover()).rejects.toThrow();
    });
});
// ── Mock executor tests ────────────────────────────────
describe('MockExecutor', () => {
    let dir;
    let exec;
    beforeEach(() => {
        dir = tempDir();
        exec = new MockExecutor();
    });
    it('architect produces architecture.md and architecture.json', async () => {
        const runDir = join(dir, 'run');
        mkdirSync(runDir, { recursive: true });
        writeFileSync(join(runDir, 'requirements.json'), JSON.stringify({ version: 1, task: 'build X', decisions: [] }));
        const r = await exec.runAgent({
            cwd: dir,
            runDir,
            task: 'build X',
            agent: 'architect',
        });
        expect(r.exitCode).toBe(0);
        expect(readFileSync(join(runDir, 'architecture.md'), 'utf-8')).toContain('Architecture');
        expect(readFileSync(join(runDir, 'architecture.json'), 'utf-8')).toContain('build X');
    });
    it('developer creates implementation.txt in project cwd', async () => {
        const runDir = join(dir, 'run');
        mkdirSync(runDir, { recursive: true });
        const r = await exec.runAgent({
            cwd: dir,
            runDir,
            task: 'impl',
            agent: 'developer',
        });
        expect(r.exitCode).toBe(0);
        expect(readFileSync(join(dir, 'src', 'implementation.txt'), 'utf-8')).toContain('Mock implementation');
    });
    it('reviewer always passes (mock)', async () => {
        const runDir = join(dir, 'run');
        mkdirSync(runDir, { recursive: true });
        const r = await exec.runAgent({
            cwd: dir,
            runDir,
            task: 'review',
            agent: 'reviewer',
        });
        expect(r.exitCode).toBe(0);
        const review = JSON.parse(readFileSync(join(runDir, 'review.json'), 'utf-8'));
        expect(review.approved).toBe(true);
    });
    it('detect() always returns true', async () => {
        expect(await exec.detect()).toBe(true);
    });
});
// ── Pipeline parser tests ──────────────────────────────
describe('PipelineParser', () => {
    it('validates pipeline agent references', () => {
        const agents = BUILTIN_AGENTS;
        const dir = tempDir();
        const pipelineDir = join(dir, 'pipelines');
        mkdirSync(pipelineDir, { recursive: true });
        writeFileSync(join(pipelineDir, 'feature.yaml'), `name: feature
stages:
  - id: rubberduck
    type: rubberduck
  - id: architect
    type: agent
    agent: architect
  - id: dev
    type: agent
    agent: developer
  - id: verifier
    type: verify
`);
        const parser = new PipelineParser();
        const pipeline = parser.loadFromDir('feature', pipelineDir);
        expect(pipeline).not.toBeNull();
        const errors = validatePipelineAgents(pipeline, agents);
        expect(errors).toHaveLength(0);
    });
    it('detects unknown agent references', () => {
        const agents = BUILTIN_AGENTS;
        const dir = tempDir();
        const pipelineDir = join(dir, 'pipelines');
        mkdirSync(pipelineDir, { recursive: true });
        writeFileSync(join(pipelineDir, 'bad.yaml'), `name: bad
stages:
  - id: agent-x
    type: agent
    agent: unknown-agent
`);
        const parser = new PipelineParser();
        const pipeline = parser.loadFromDir('bad', pipelineDir);
        const errors = validatePipelineAgents(pipeline, agents);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('unknown-agent');
    });
});
// ── End-to-end mock orchestrator test ──────────────────
describe('RunOrchestrator (mock end-to-end)', () => {
    let dir;
    let runStore;
    let events;
    let artifacts;
    const mockExecutor = new MockExecutor();
    const mockDriver = new MockRubberduckDriver();
    const agentsMap = new Map(BUILTIN_AGENTS.map((a) => [a.id, { ...a, executor: 'mock' }]));
    const executorsMap = new Map([['mock', mockExecutor]]);
    function makePipeline(stages) {
        return {
            name: 'test-pipeline',
            description: 'test pipeline',
            version: 1,
            repair: { max_cycles: 3, reject_on: ['critical', 'high'] },
            stages,
        };
    }
    beforeEach(() => {
        dir = tempDir();
        runStore = new RunStore(dir);
        events = new EventLog(dir);
        artifacts = new ArtifactStore(dir);
    });
    it('runs a minimal pipeline: rubberduck → architect → verify → PASS', async () => {
        const run = runStore.create('run-1', 'test-pipeline', 'implement feature X');
        const pipeline = makePipeline([
            { id: 'rubberduck', type: 'rubberduck' },
            { id: 'architect', type: 'agent', agent: 'architect' },
            { id: 'verifier', type: 'verify' },
        ]);
        const orchestrator = new RunOrchestrator({
            runStore,
            events,
            artifacts,
            cwd: dir,
            agents: agentsMap,
            executors: executorsMap,
            config: {
                repair: { max_cycles: 3, reject_on: ['critical', 'high'] },
                verification: { commands: ['echo ok'] },
            },
            rubberduck: mockDriver,
        });
        const result = await orchestrator.run(pipeline, run);
        expect(result).toBe('PASS');
        // Artifacts exist
        expect(artifacts.read('requirements')).not.toBeNull();
        expect(artifacts.readRaw('architecture.md')).not.toBeNull();
    });
    it('PASSes when review finds nothing above threshold', async () => {
        const run = runStore.create('run-ok', 'test-pipeline', 'feature');
        const pipeline = makePipeline([
            { id: 'rubberduck', type: 'rubberduck' },
            { id: 'architect', type: 'agent', agent: 'architect' },
            {
                id: 'implementation',
                type: 'loop',
                max_cycles: 3,
                gate: 'no-findings-above-threshold',
                stages: [
                    { id: 'developer', type: 'agent', agent: 'developer' },
                    { id: 'reviewer', type: 'agent', agent: 'reviewer' },
                ],
            },
            { id: 'verifier', type: 'verify' },
        ]);
        const orchestrator = new RunOrchestrator({
            runStore,
            events,
            artifacts,
            cwd: dir,
            agents: agentsMap,
            executors: executorsMap,
            config: {
                repair: { max_cycles: 3, reject_on: ['critical', 'high'] },
                verification: { commands: ['echo ok'] },
            },
            rubberduck: mockDriver,
        });
        const result = await orchestrator.run(pipeline, run);
        expect(result).toBe('PASS');
        // Mock reviewer approves, so repair loop ran once
        expect(events.filter('repair.started')).toHaveLength(1);
        const final = runStore.load('run-ok');
        expect(final?.state).toBe('PASS');
    });
});
//# sourceMappingURL=runtime.test.js.map