import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Run, RunState, RunSchema, StageResult } from '@volibear/contracts';

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
   * Create a new run.
   */
  create(
    id: string,
    pipeline: string,
    task: string,
    findingsFile?: string,
  ): Run {
    const now = new Date().toISOString();
    const run = RunSchema.parse({
      id,
      pipeline,
      state: 'CREATED',
      task,
      findings_file: findingsFile,
      created_at: now,
      updated_at: now,
    });
    this.save(run);
    return run;
  }

  /**
   * Save/update a run to disk.
   */
  save(run: Run): void {
    mkdirSync(this.runDir(run.id), { recursive: true });
    const filePath = join(this.runDir(run.id), 'run.json');
    writeFileSync(filePath, JSON.stringify(run, null, 2), 'utf-8');
  }

  /**
   * Load a run from disk.
   */
  load(id: string): Run | null {
    const filePath = join(this.runDir(id), 'run.json');
    if (!existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      return RunSchema.parse(raw) as Run;
    } catch {
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
   * List all runs.
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
    // Sort by created_at descending, tiebreak by id descending (id is monotonic)
    runs.sort((a, b) => {
      const byTime = b.created_at.localeCompare(a.created_at);
      if (byTime !== 0) return byTime;
      return b.id.localeCompare(a.id);
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