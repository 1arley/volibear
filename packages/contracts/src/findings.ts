import { z } from 'zod';

// ── External findings contract (ORNN, Semgrep, etc.) ───

export const ExternalFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  evidence: z.string().optional(),
  recommendation: z.string().optional(),
  source: z.string().optional(),
  category: z.string().optional(),
});

export const ExternalFindingsFileSchema = z.object({
  findings: z.array(ExternalFindingSchema).min(1),
});

export type ExternalFinding = z.infer<typeof ExternalFindingSchema>;
export type ExternalFindingsFile = z.infer<typeof ExternalFindingsFileSchema>;
