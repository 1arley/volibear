import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const cliPath = join(root, 'dist', 'index.js');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'volibear-build-test-'));
}

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe('mock executor guard (build)', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    // Initialize a volibear project with default mock executor
    runCli(['install', '--project'], dir);
  });

  it('build fails when all agents use mock executor', () => {
    const result = runCli(['build', 'add a health endpoint'], dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('mock');
    expect(result.stderr).toContain('no real implementation');
    expect(result.stderr).toContain('--executor opencode');
  });

  it('build succeeds with --allow-mock', () => {
    const result = runCli(['build', 'add a health endpoint', '--accept-defaults', '--allow-mock'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PASS');
  });

  it('build fails with --executor mock (explicit)', () => {
    const result = runCli(['build', 'add a health endpoint', '--executor', 'mock'], dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('mock');
  });
});

describe('mock executor guard (fix)', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    runCli(['install', '--project'], dir);
  });

  it('fix fails when all agents use mock executor', () => {
    const findings = JSON.stringify({
      findings: [{ id: 'F001', severity: 'low', title: 'test finding' }],
    });
    const findingsPath = join(dir, 'findings.json');
    writeFileSync(findingsPath, findings);
    const result = runCli(['fix', findingsPath], dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('mock');
    expect(result.stderr).toContain('no real implementation');
  });
});
