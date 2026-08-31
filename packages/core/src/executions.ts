import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StageExecutionRecord, StageExecutionRecordSchema } from '@volibear/contracts';

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf-8');
  renameSync(temporary, path);
}

/** Persists transport attempts separately from domain artifacts. */
export class StageExecutionStore {
  constructor(private readonly runDir: string) {}

  executionDir(executionId: string): string {
    const safe = executionId.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return join(this.runDir, 'executions', safe);
  }

  create(record: StageExecutionRecord, handoff: unknown): StageExecutionRecord {
    const parsed = StageExecutionRecordSchema.parse(record);
    const dir = this.executionDir(parsed.execution_id);
    atomicWrite(join(dir, 'handoff.json'), JSON.stringify(handoff, null, 2));
    atomicWrite(join(dir, 'execution.json'), JSON.stringify(parsed, null, 2));
    return parsed;
  }

  load(executionId: string): StageExecutionRecord | null {
    const path = join(this.executionDir(executionId), 'execution.json');
    if (!existsSync(path)) return null;
    try {
      return StageExecutionRecordSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
    } catch {
      return null;
    }
  }

  update(executionId: string, patch: Partial<StageExecutionRecord>): StageExecutionRecord {
    const current = this.load(executionId);
    if (!current) throw new Error(`execution "${executionId}" not found`);
    const updated = StageExecutionRecordSchema.parse({ ...current, ...patch });
    atomicWrite(
      join(this.executionDir(executionId), 'execution.json'),
      JSON.stringify(updated, null, 2),
    );
    return updated;
  }

  writeRawOutput(executionId: string, output: string): string {
    const path = join(this.executionDir(executionId), 'raw-output.txt');
    atomicWrite(path, output);
    return path;
  }

  writeStructuredOutput(executionId: string, output: unknown): string {
    const path = join(this.executionDir(executionId), 'structured-output.json');
    atomicWrite(path, JSON.stringify(output, null, 2));
    return path;
  }
}
