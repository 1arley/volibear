import { z } from 'zod';

// ── Run states ─────────────────────────────────────────

export const RunStateSchema = z.enum([
  'CREATED',
  'DISCOVERY',
  'WAITING_FOR_USER',
  'REQUIREMENTS_LOCKED',
  'ARCHITECTURE',
  'IMPLEMENTATION',
  'REVIEW',
  'FIXING',
  'VERIFICATION',
  'PASS',
  'FAIL',
  'BLOCKED',
]);

export type RunState = z.infer<typeof RunStateSchema>;

// ── Run ────────────────────────────────────────────────

export const RunSchema = z.object({
  id: z.string().min(1),
  pipeline: z.string().min(1),
  state: RunStateSchema,
  task: z.string().min(1),
  findings_file: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  current_stage: z.string().optional(),
  completed_stages: z.array(z.string()).default([]),
  repair_cycle: z.number().int().nonnegative().default(0),
  /** OpenCode primary session shared by all native stages in this run. */
  native_session_id: z.string().optional(),
  native_server_url: z.string().url().optional(),
  /** Monotonic creation sequence within the project; orders same-ms runs. */
  seq: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export type Run = z.infer<typeof RunSchema>;

// ── Stage execution record ─────────────────────────────

export const StageResultSchema = z.object({
  stage_id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  artifact_path: z.string().optional(),
  error: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});

export type StageResult = z.infer<typeof StageResultSchema>;
