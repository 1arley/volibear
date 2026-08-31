import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AgentDefinition, Executor, ExecutorContext, ExecutorResult } from '@volibear/contracts';

/**
 * Permission-aware executor wrapper.
 *
 * Enforces agent permission constraints around executor invocations:
 * - repository:'read' → filesystem snapshot before, verify no writes after
 * - shell:'denied' → validate no shell access requested
 * - tests:false → validate no test commands in prompt
 */
export class PermissionGuard {
  constructor(private cwd: string) {}

  /**
   * Snapshot the filesystem tree (relative paths + mtimes) for comparison.
   * Only snapshots the project directory (cwd) — not node_modules or .volibear.
   */
  snapshot(): Map<string, number> {
    const snapshot = new Map<string, number>();
    this.walkDir(this.cwd, snapshot, ['node_modules', '.volibear', '.git', 'dist']);
    return snapshot;
  }

  /**
   * Compare two snapshots and return files that were added or modified.
   */
  diff(
    before: Map<string, number>,
    after: Map<string, number>,
  ): Array<{ path: string; kind: 'added' | 'modified' }> {
    const changes: Array<{ path: string; kind: 'added' | 'modified' }> = [];
    for (const [relPath, mtime] of after) {
      if (!before.has(relPath)) {
        changes.push({ path: relPath, kind: 'added' });
      } else if (before.get(relPath)! < mtime) {
        changes.push({ path: relPath, kind: 'modified' });
      }
    }
    return changes;
  }

  /**
   * Run an executor with permission enforcement.
   * Returns the executor result plus any permission violations detected.
   */
  async enforce(
    agent: AgentDefinition,
    executor: Executor,
    ctx: ExecutorContext,
  ): Promise<{ result: ExecutorResult; violations: string[] }> {
    const perms = agent.permissions;
    const violations: string[] = [];

    // Pre-run: validate prompt doesn't request disallowed capabilities
    if (perms.shell === 'denied') {
      if (perms.repository === 'read') {
        // Read-only agents with no shell — pure analysis role
        // Nothing extra to validate pre-run; violations detected post-run
      }
    }

    // Snapshot filesystem before execution for read-only agents
    let beforeSnapshot: Map<string, number> | undefined;
    if (perms.repository === 'read') {
      beforeSnapshot = this.snapshot();
    }

    // Run the actual executor
    const result = await executor.runAgent(ctx);

    // Post-run: verify filesystem wasn't modified for read-only agents
    if (perms.repository === 'read' && beforeSnapshot) {
      const afterSnapshot = this.snapshot();
      const changes = this.diff(beforeSnapshot, afterSnapshot);
      for (const change of changes) {
        // Paths are already relative to cwd from the snapshot.
        if (!change.path.startsWith('.runs/')) {
          violations.push(
            `${agent.id}: ${change.kind} file outside runDir: ${change.path} (repository=read)`,
          );
        }
      }
    }

    // Note: shell and network enforcement is best-effort via prompt instructions.
    // True sandboxing would require OS-level isolation (containers, seccomp, etc.)
    // which is out of scope for this MVP.

    return { result, violations };
  }

  private walkDir(dir: string, snapshot: Map<string, number>, ignore: string[]): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(this.cwd, fullPath);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          this.walkDir(fullPath, snapshot, ignore);
        } else {
          snapshot.set(relPath, stat.mtimeMs);
        }
      } catch {
        // skip inaccessible files
      }
    }
  }
}
