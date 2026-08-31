import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('parses --both into options.both', () => {
    const { command, options } = parseArgs(['install', '--both']);
    expect(command).toBe('install');
    expect(options.both).toBe(true);
  });

  it('still parses --project and --global', () => {
    expect(parseArgs(['install', '--project']).options.project).toBe(true);
    expect(parseArgs(['install', '--global']).options.global).toBe(true);
  });

  it('parses value options --executor/--router/--pipeline', () => {
    const { options } = parseArgs([
      'install', '--executor', 'claude', '--router', '9router', '--pipeline', 'fix',
    ]);
    expect(options.executor).toBe('claude');
    expect(options.router).toBe('9router');
    expect(options.pipeline).toBe('fix');
  });

  it('reports an error when a value option lacks a value', () => {
    const { errors } = parseArgs(['install', '--executor']);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('keeps positionals after the command', () => {
    const { command, positional } = parseArgs(['install', 'opencode', 'codex']);
    expect(command).toBe('install');
    expect(positional).toEqual(['opencode', 'codex']);
  });

  it('supports --both with positionals', () => {
    const { positional, options } = parseArgs(['install', '--both', 'opencode', 'codex']);
    expect(positional).toEqual(['opencode', 'codex']);
    expect(options.both).toBe(true);
  });

  it('parses a host-provided resume answer', () => {
    const { command, options } = parseArgs(['resume', '--answer', 'Use SQLite']);
    expect(command).toBe('resume');
    expect(options.answer).toBe('Use SQLite');
  });
});
