import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Event, EventType } from '@volibear/contracts';

/**
 * Event log — append-only JSONL file.
 */
export class EventLog {
  private filePath: string;
  private entries: Event[] = [];

  constructor(runDir: string) {
    mkdirSync(runDir, { recursive: true });
    this.filePath = join(runDir, 'events.jsonl');
    this.loadExisting();
  }

  private loadExisting(): void {
    if (!existsSync(this.filePath)) return;
    const content = readFileSync(this.filePath, 'utf-8');
    for (const line of content.trim().split('\n').filter(Boolean)) {
      try {
        this.entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }

  /**
   * Append an event to the log.
   */
  record(event: EventType, runId?: string, data?: Record<string, unknown>): Event {
    const entry: Event = {
      timestamp: new Date().toISOString(),
      event,
      run_id: runId,
      data,
    };
    this.entries.push(entry);
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  }

  /**
   * Return all recorded events.
   */
  all(): Event[] {
    return [...this.entries];
  }

  /**
   * Filter events by type.
   */
  filter(type: EventType): Event[] {
    return this.entries.filter((e) => e.event === type);
  }

  /**
   * Get the last event of a given type.
   */
  last(type: EventType): Event | undefined {
    const filtered = this.filter(type);
    return filtered[filtered.length - 1];
  }

  /**
   * Clear all events (for testing).
   */
  clear(): void {
    this.entries = [];
    writeFileSync(this.filePath, '', 'utf-8');
  }
}