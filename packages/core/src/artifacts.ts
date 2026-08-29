import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArtifactKind } from '@volibear/contracts';

/**
 * Artifact store — read/write structured artifacts to disk.
 */
export class ArtifactStore {
  /** Run directory on disk where artifacts live */
  readonly dir: string;

  constructor(runDir: string) {
    this.dir = runDir;
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Write an artifact to the run directory.
   */
  write(kind: ArtifactKind, data: unknown): string {
    const filePath = join(this.dir, `${kind}.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Read an artifact from the run directory.
   */
  read<T>(kind: ArtifactKind): T | null {
    const filePath = join(this.dir, `${kind}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * Check if an artifact exists.
   */
  exists(kind: ArtifactKind): boolean {
    return existsSync(join(this.dir, `${kind}.json`));
  }

  /**
   * Write a non-JSON file (e.g., architecture.md).
   */
  writeRaw(filename: string, content: string): string {
    const filePath = join(this.dir, filename);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * Read a raw file.
   */
  readRaw(filename: string): string | null {
    const filePath = join(this.dir, filename);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  }
}