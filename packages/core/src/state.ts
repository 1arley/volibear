import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Run, RunSchema } from '@volibear/contracts';

/** Write a file atomically (temp file + rename) so a crash never tears it. */
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Run state manager — persists pipeline runs to disk.
 */
export class RunStore {
  private runsDir: string;

  constructor(runsDir: string) {
    this.runsDir = runsDir;
    mkdirSync(this.runsDir, { recursive: true });
  }

  /**
   * Generate a run directory path.
   */
  runDir(runId: string): string {
    return join(this.runsDir, runId);
  }

  /**
   * Create a new run with a monotonic sequence number.
   */
  create(
    id: string,
    pipeline: string,
    task: string,
    findingsFile?: string,
  ): Run {
    const now = new Date().toISOString();
    const seq = this.list().reduce((max, r) => Math.max(max, r.seq ?? 0), 0) + 1;
    const run = RunSchema.parse({
      id,
      pipeline,
      state: 'CREATED',
      task,
      findings_file: findingsFile,
      created_at: now,
      updated_at: now,
      seq,
    });
    this.save(run);
    return run;
  }

  /**
   * Save/update a run to disk (atomic write).
   */
  save(run: Run): void {
    mkdirSync(this.runDir(run.id), { recursive: true });
    const filePath = join(this.runDir(run.id), 'run.json');
    atomicWrite(filePath, JSON.stringify(run, null, 2));
  }

  /**
   * Load a run from disk. Returns null when missing; warns on corrupted files.
   */
  load(id: string): Run | null {
    const filePath = join(this.runDir(id), 'run.json');
    if (!existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      return RunSchema.parse(raw) as Run;
    } catch (err) {
      console.error(
        `[volibear] warning: run "${id}" has an unreadable run.json (${err instanceof Error ? err.message.split('\n')[0] : err}) — it will be skipped`,
      );
      return null;
    }
  }

  /**
   * Update a run's state and/or fields.
   */
  update(
    id: string,
    updates: Partial<Omit<Run, 'id' | 'created_at'>>,
  ): Run | null {
    const run = this.load(id);
    if (!run) return null;
    const updated: Run = {
      ...run,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save(updated);
    return updated;
  }

  /**
   * List all runs (corrupted runs are skipped with a warning).
   */
  list(): Run[] {
    if (!existsSync(this.runsDir)) return [];
    const dirs = readdirSync(this.runsDir, { withFileTypes: true });
    const runs: Run[] = [];
    for (const dirent of dirs) {
      if (dirent.isDirectory()) {
        const run = this.load(dirent.name);
        if (run) runs.push(run);
      }
    }
    // Sort by created_at descending; same-millisecond ties are broken by the
    // monotonic creation sequence (older runs may have no seq — treated last),
    // never by the random run id.
    runs.sort((a, b) => {
      const byTime = b.created_at.localeCompare(a.created_at);
      if (byTime !== 0) return byTime;
      return (b.seq ?? -1) - (a.seq ?? -1);
    });
    return runs;
  }

  /**
   * Get the latest run.
   */
  latest(): Run | null {
    const runs = this.list();
    return runs[0] || null;
  }
}