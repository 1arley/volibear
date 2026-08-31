import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InstallPlan, InstallResult } from './types.js';

export interface InstallFileSystem {
  exists(path: string): boolean;
  mkdir(path: string): void;
  write(path: string, content: string): void;
  dirname(path: string): string;
}

/** Concrete filesystem using Node.js sync APIs. */
export const realFS: InstallFileSystem = {
  exists: (p) => existsSync(p),
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  write: (p, c) => writeFileSync(p, c, 'utf-8'),
  dirname: (p) => dirname(p),
};

/**
 * Apply an approved install plan to the filesystem.
 * Returns a result with per-file outcomes.
 *
 * I/O failures (mkdir/write) are captured per file as `{ file, outcome:
 * 'failed', error }` and abort the rest of the plan, so a partial install is
 * always visible in the returned report instead of surfacing as an uncaught
 * exception (MED-4).
 *
 * IMPORTANT: this function MUST NOT be called before the user confirms
 * the plan. The wizard must only call `createInstallPlan` to build the
 * plan, then call `applyInstallPlan` AFTER the user confirms.
 */
export function applyInstallPlan(
  plan: InstallPlan,
  fs: InstallFileSystem = realFS,
): InstallResult {
  const applied: InstallResult['files'] = [];

  for (const file of plan.files) {
    if (file.action === 'keep') {
      applied.push({ file, outcome: 'kept' });
      continue;
    }

    if (file.content === undefined) {
      // No content (shouldn't happen for create/overwrite) — skip.
      applied.push({ file, outcome: 'skipped' });
      continue;
    }

    try {
      // For create / overwrite, ensure the parent directory exists.
      fs.mkdir(fs.dirname(file.path));
      fs.write(file.path, file.content);
      applied.push({ file, outcome: file.action === 'overwrite' ? 'overwritten' : 'written' });
    } catch (err) {
      applied.push({
        file,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      // Stop on the first failure: continuing could leave the install in a
      // half-written state that the report cannot explain.
      break;
    }
  }

  return { files: applied, warnings: [...plan.warnings] };
}
