import { describe, it, expect } from 'vitest';
import { CliRubberduckDriver } from './cli-rubberduck.js';
import { Executor, ExecutorContext, ExecutorResult } from '@volibear/contracts';

/**
 * A fake executor that returns canned LLM-like responses.
 * Used to test CliRubberduckDriver without a real coding CLI.
 */
function createFakeExecutor(responses: Record<string, string>): Executor {
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
      const output = responses[key] ?? responses['default'] ?? '';
      return { exitCode: 0, stdout: output, stderr: '' };
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
      const executor = createFakeExecutor({
        rubberduck: JSON.stringify({ version: 'bad', task: 123 }),
      });
      const driver = createDriver(executor);

      await expect(
        driver.generateRequirements('task', []),
      ).rejects.toThrow();
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
