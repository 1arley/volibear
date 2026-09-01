import { describe, it, expect } from 'vitest';
import { CliRubberduckDriver } from './cli-rubberduck.js';
import { Executor, ExecutorContext, ExecutorResult } from '@volibear/contracts';

/** Canned response a fake executor returns for one agent invocation. */
interface CannedResponse {
  stdout?: string;
  structured?: Record<string, unknown>;
}

/**
 * A fake executor that returns canned LLM-like responses.
 * Used to test CliRubberduckDriver without a real coding CLI.
 * Responses may include `structured` to emulate executors like opencode
 * that surface parsed structured output alongside raw stdout.
 */
function createFakeExecutor(responses: Record<string, string | CannedResponse>): Executor {
  return {
    id: 'fake',
    capabilities: {
      headless: true,
      interactive: false,
      filesystem: false,
      tools: false,
      custom_endpoint: false,
      structured_output: false,
    },
    async detect() {
      return true;
    },
    async runAgent(ctx: ExecutorContext): Promise<ExecutorResult> {
      const key = ctx.agent;
      const response = responses[key] ?? responses['default'] ?? '';
      if (typeof response === 'string') {
        return { exitCode: 0, stdout: response, stderr: '' };
      }
      return {
        exitCode: 0,
        stdout: response.stdout ?? '',
        stderr: '',
        structured: response.structured,
      };
    },
  };
}

function createDriver(executor: Executor) {
  return new CliRubberduckDriver(executor, {
    cwd: '/tmp/test',
    runDir: '/tmp/test/.volibear/.runs/run-1',
  });
}

describe('CliRubberduckDriver', () => {
  describe('discover()', () => {
    it('parses questions from LLM output', async () => {
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify([
          { id: 'Q1', text: 'Use TypeScript?', type: 'BLOCKING' },
          { id: 'Q2', text: 'Add tests?', type: 'OPTIONAL' },
        ]),
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('add auth', {});

      expect(questions).toHaveLength(2);
      expect(questions[0].id).toBe('Q1');
      expect(questions[0].text).toBe('Use TypeScript?');
      expect(questions[0].type).toBe('BLOCKING');
      expect(questions[1].type).toBe('OPTIONAL');
    });

    it('handles prose before JSON in LLM output', async () => {
      const executor = createFakeExecutor({
        rubberduck: 'Here are the questions:\n' + JSON.stringify([
          { id: 'Q1', text: 'Proceed?', type: 'BLOCKING' },
        ]),
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('task', {});

      expect(questions).toHaveLength(1);
      expect(questions[0].id).toBe('Q1');
    });

    it('recovers a rendered OpenCode question when JSON is wrapped away', async () => {
      const executor = createFakeExecutor({
        rubberduck: 'Returned 1 BLOCKING question:\n\n**Q1** — Preserve the trailing newline?',
      });
      const questions = await createDriver(executor).discover('task', {});
      expect(questions).toEqual([{ id: 'Q1', text: 'Preserve the trailing newline?', type: 'BLOCKING' }]);
    });

    it('throws on non-JSON output', async () => {
      const executor = createFakeExecutor({
        rubberduck: 'I do not understand the request.',
      });
      const driver = createDriver(executor);

      await expect(driver.discover('task', {})).rejects.toThrow('no JSON');
    });

    it('throws on non-array JSON', async () => {
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify({ id: 'Q1', text: 'test', type: 'BLOCKING' }),
      });
      const driver = createDriver(executor);

      await expect(driver.discover('task', {})).rejects.toThrow('non-array');
    });

    it('passes findings context to the executor prompt', async () => {
      let capturedTask = '';
      const executor: Executor = {
        id: 'spy',
        capabilities: {
          headless: true, interactive: false, filesystem: false,
          tools: false, custom_endpoint: false, structured_output: false,
        },
        async detect() { return true; },
        async runAgent(ctx: ExecutorContext) {
          capturedTask = ctx.task;
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ id: 'Q1', text: 'Ok?', type: 'BLOCKING' }]),
            stderr: '',
          };
        },
      };
      const driver = createDriver(executor);
      const findings = { findings: [{ id: 'F1', severity: 'high', title: 'XSS' }] };
      await driver.discover('task', { findings });

      expect(capturedTask).toContain('External findings');
      expect(capturedTask).toContain('XSS');
    });

    it('normalizes unknown question types to BLOCKING', async () => {
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify([
          { id: 'Q1', text: 'test', type: 'INVALID' },
        ]),
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('task', {});

      expect(questions[0].type).toBe('BLOCKING');
    });
  });

  describe('structured output preference', () => {
    const questionsJson = JSON.stringify([
      { id: 'Q1', text: 'Use TypeScript?', type: 'BLOCKING' },
    ]);

    it('discover() prefers structured.output over polluted stdout', async () => {
      const executor = createFakeExecutor({
        rubberduck: {
          stdout: '> opencode v1.0\nTUI noise with no JSON at all',
          structured: { output: questionsJson },
        },
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('task', {});

      expect(questions).toHaveLength(1);
      expect(questions[0].text).toBe('Use TypeScript?');
    });

    it('decide() prefers structured.output over polluted stdout', async () => {
      const executor = createFakeExecutor({
        rubberduck: {
          stdout: '> opencode v1.0\nTUI noise',
          structured: { output: 'Yes, use TypeScript.' },
        },
      });
      const driver = createDriver(executor);
      const result = await driver.decide(
        { id: 'Q1', text: 'Use TypeScript?', type: 'BLOCKING' },
        'task',
      );

      expect(result.answer).toBe('Yes, use TypeScript.');
    });

    it('generateRequirements() prefers structured.output over polluted stdout', async () => {
      const req = {
        version: 1,
        task: 'wrong-task-copy',
        decisions: [],
        assumptions: [],
        constraints: [],
        acceptance_intent: [],
        unresolved: [],
      };
      const executor = createFakeExecutor({
        rubberduck: {
          stdout: '> opencode v1.0\nTUI noise',
          structured: { output: JSON.stringify(req) },
        },
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('true-task', []);

      // task is always overridden with the driver's task parameter.
      expect(result.task).toBe('true-task');
    });

    it('falls back to raw stdout when structured.output is absent', async () => {
      const executor = createFakeExecutor({
        rubberduck: {
          stdout: questionsJson,
          structured: { other: 'field' },
        },
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('task', {});

      expect(questions).toHaveLength(1);
      expect(questions[0].id).toBe('Q1');
    });

    it('falls back to raw stdout when structured.output is empty string', async () => {
      const executor = createFakeExecutor({
        rubberduck: {
          stdout: questionsJson,
          structured: { output: '' },
        },
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('task', {});

      expect(questions).toHaveLength(1);
      expect(questions[0].id).toBe('Q1');
    });

    it('falls back to raw stdout when structured is undefined', async () => {
      const executor = createFakeExecutor({
        rubberduck: {
          stdout: questionsJson,
        },
      });
      const driver = createDriver(executor);
      const questions = await driver.discover('task', {});

      expect(questions).toHaveLength(1);
      expect(questions[0].id).toBe('Q1');
    });
  });

  describe('decide()', () => {
    it('returns the LLM answer', async () => {
      const executor = createFakeExecutor({
        rubberduck: 'Yes, use TypeScript for type safety.',
      });
      const driver = createDriver(executor);
      const result = await driver.decide(
        { id: 'Q1', text: 'Use TypeScript?', type: 'BLOCKING' },
        'task',
      );

      expect(result.answer).toBe('Yes, use TypeScript for type safety.');
      expect(result.selectedBy).toBe('cli-rubberduck');
    });

    it('throws on empty answer', async () => {
      const executor = createFakeExecutor({
        rubberduck: '   ',
      });
      const driver = createDriver(executor);

      await expect(
        driver.decide({ id: 'Q1', text: 'test', type: 'BLOCKING' }, 'task'),
      ).rejects.toThrow('empty answer');
    });
  });

  describe('generateRequirements()', () => {
    it('parses valid requirements JSON', async () => {
      const req = {
        version: 1,
        task: 'test',
        decisions: [],
        assumptions: [],
        constraints: [],
        acceptance_intent: [],
        unresolved: [],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.version).toBe(1);
      expect(result.task).toBe('test');
    });

    it('throws on invalid requirements JSON', async () => {
      // A top-level array cannot be normalized into a requirements object.
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify([1, 2, 3]),
      });
      const driver = createDriver(executor);

      await expect(
        driver.generateRequirements('task', []),
      ).rejects.toThrow();
    });

    it('overrides the LLM task copy with the true task', async () => {
      const req = {
        version: 1,
        task: 'LLM hallucinated task',
        decisions: [],
        assumptions: [],
        constraints: [],
        acceptance_intent: [],
        unresolved: [],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('the real task', []);

      expect(result.task).toBe('the real task');
    });

    it('defaults missing version to 1', async () => {
      const req = {
        task: 'test',
        decisions: [],
        assumptions: [],
        constraints: [],
        acceptance_intent: [],
        unresolved: [],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.version).toBe(1);
    });

    it('coerces assumptions objects with known text fields to strings', async () => {
      const req = {
        version: 1,
        task: 'test',
        assumptions: [
          { text: 'from text field' },
          { description: 'from description field' },
          { summary: 'from summary field' },
          { message: 'from message field' },
        ],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.assumptions).toEqual([
        'from text field',
        'from description field',
        'from summary field',
        'from message field',
      ]);
    });

    it('stringifies assumptions objects with unknown fields', async () => {
      const req = {
        version: 1,
        task: 'test',
        assumptions: [{ foo: 'bar', baz: 1 }],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.assumptions).toEqual([JSON.stringify({ foo: 'bar', baz: 1 })]);
    });

    it('coerces non-string primitives and drops null entries', async () => {
      const req = {
        version: 1,
        task: 'test',
        assumptions: [42, true, null, undefined, 'kept'],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.assumptions).toEqual(['42', 'true', 'kept']);
    });

    it('treats non-array assumptions as empty', async () => {
      const req = {
        version: 1,
        task: 'test',
        assumptions: 'not-an-array',
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.assumptions).toEqual(['not-an-array']);
    });

    it('converts unresolved string entries to objects with U-ids', async () => {
      const req = {
        version: 1,
        task: 'test',
        unresolved: ['needs rate limiting?', 'which DB?'],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.unresolved).toEqual([
        { id: 'U1', question: 'needs rate limiting?', type: 'BLOCKING' },
        { id: 'U2', question: 'which DB?', type: 'BLOCKING' },
      ]);
    });

    it('fills missing unresolved id with U-index', async () => {
      const req = {
        version: 1,
        task: 'test',
        unresolved: [{ question: 'No id here', type: 'OPTIONAL' }],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.unresolved).toEqual([
        { id: 'U1', question: 'No id here', type: 'OPTIONAL' },
      ]);
    });

    it('extracts question text from malformed unresolved objects', async () => {
      const req = {
        version: 1,
        task: 'test',
        unresolved: [
          { id: 'UX', text: 'from text field' },
          { id: 'UY', description: 'from description' },
          { id: 'UZ', summary: 'from summary' },
          { id: 'UM', message: 'from message' },
          { id: 'UU', unknown: 'no known fields' },
          { id: 'UL', question: '', text: 'empty question falls back' },
        ],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.unresolved).toEqual([
        { id: 'UX', question: 'from text field', type: 'BLOCKING' },
        { id: 'UY', question: 'from description', type: 'BLOCKING' },
        { id: 'UZ', question: 'from summary', type: 'BLOCKING' },
        { id: 'UM', question: 'from message', type: 'BLOCKING' },
        { id: 'UU', question: JSON.stringify({ id: 'UU', unknown: 'no known fields' }), type: 'BLOCKING' },
        { id: 'UL', question: 'empty question falls back', type: 'BLOCKING' },
      ]);
    });

    it('drops null unresolved entries and normalizes invalid types', async () => {
      const req = {
        version: 1,
        task: 'test',
        unresolved: [
          null,
          { id: 'U1', question: 'kept', type: 'WEIRD' },
          { id: 'U2', question: 'also kept', type: 'INFERABLE' },
        ],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.unresolved).toEqual([
        // invalid type is dropped; schema default (BLOCKING) applies
        { id: 'U1', question: 'kept', type: 'BLOCKING' },
        { id: 'U2', question: 'also kept', type: 'INFERABLE' },
      ]);
    });

    it('treats non-array unresolved as empty', async () => {
      const req = {
        version: 1,
        task: 'test',
        unresolved: { id: 'U1', question: 'object not array' },
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.unresolved).toEqual([]);
    });

    it('keeps valid decisions and fills invalid answer_source with delegated', async () => {
      const req = {
        version: 1,
        task: 'test',
        decisions: [
          { id: 'Q1', question: 'Auth approach?', answer: 'JWT', answer_source: 'user' },
          { id: 'Q2', question: 'DB?', answer: 'Postgres', answer_source: 'weird' },
          { id: 'Q3', question: 'Cache?', answer: 'Redis' },
          { id: 'Q4', question: 'Broken?', answer: 42 },
          { id: 'Q5', question: 7, answer: 'x' },
          { answer: 'no id/question' },
          null,
        ],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const questions = [
        { id: 'Q1', text: 'Auth approach?', type: 'BLOCKING' as const, answer: 'JWT', answer_source: 'user' as const },
        { id: 'Q2', text: 'DB?', type: 'BLOCKING' as const, answer: 'Postgres' },
        { id: 'Q3', text: 'Cache?', type: 'OPTIONAL' as const, answer: 'Redis' },
      ];
      const result = await driver.generateRequirements('test', questions);

      expect(result.decisions).toHaveLength(3);
      expect(result.decisions.map((d) => d.id)).toEqual(['Q1', 'Q2', 'Q3']);
      expect(result.decisions[0].answer_source).toBe('user');
      expect(result.decisions[1].answer_source).toBe('delegated');
      expect(result.decisions[2].answer_source).toBe('delegated');
      expect(result.decisions.map((d) => d.question)).toEqual(['Auth approach?', 'DB?', 'Cache?']);
    });

    it('drops non-string primitives in string arrays via JSON semantics', async () => {
      const req = {
        version: 1,
        task: 'test',
        constraints: [{ text: 'constraint object' }],
      };
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify(req),
      });
      const driver = createDriver(executor);
      const result = await driver.generateRequirements('test', []);

      expect(result.constraints).toEqual(['constraint object']);
    });
  });

  describe('id', () => {
    it('has correct id', () => {
      const executor = createFakeExecutor({});
      const driver = createDriver(executor);
      expect(driver.id).toBe('cli-rubberduck');
    });
  });
});
