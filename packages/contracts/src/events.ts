import { z } from 'zod';

// ── Event types ────────────────────────────────────────

export const EventTypeSchema = z.enum([
  'run.started',
  'run.completed',
  'run.failed',
  'run.blocked',
  'stage.started',
  'stage.completed',
  'stage.failed',
  'rubberduck.question.created',
  'rubberduck.question.answered',
  'rubberduck.state.changed',
  'requirements.locked',
  'requirements.invalidated',
  'review.rejected',
  'review.approved',
  'repair.started',
  'repair.cycle.completed',
  'verification.command.executed',
  'verification.completed',
  'gate.passed',
  'gate.failed',
]);

// ── Event ──────────────────────────────────────────────

export const EventSchema = z.object({
  timestamp: z.string().datetime(),
  event: EventTypeSchema,
  run_id: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

export type EventType = z.infer<typeof EventTypeSchema>;
export type Event = z.infer<typeof EventSchema>;
