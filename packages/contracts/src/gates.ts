import { z } from 'zod';

// ── Gate result ────────────────────────────────────────

export const GateResultSchema = z.object({
  passed: z.boolean(),
  gate: z.string(),
  reason: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type GateResult = z.infer<typeof GateResultSchema>;

// ── Gate identifiers ───────────────────────────────────

export const GateIdSchema = z.enum([
  'blocking-questions-resolved',
  'requirements-locked',
  'review-no-critical-findings',
  'review-no-high-findings',
  'tests-pass',
  'repair-cycles-within-limit',
  'artifacts-exist',
]);

export type GateId = z.infer<typeof GateIdSchema>;
