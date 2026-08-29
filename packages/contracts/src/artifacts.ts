import { z } from 'zod';

// ── Requirements ───────────────────────────────────────

export const DecisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  answer_source: z.enum(['user', 'delegated']),
  selected_by: z.string().optional(),
  approved_by_user: z.boolean().default(true),
  timestamp: z.string().datetime().optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const RequirementsSchema = z.object({
  version: z.number().int().positive(),
  task: z.string().min(1),
  decisions: z.array(DecisionSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  acceptance_intent: z.array(z.string()).default([]),
  unresolved: z.array(z.object({
    id: z.string(),
    question: z.string(),
    type: z.enum(['BLOCKING', 'OPTIONAL', 'INFERABLE']),
  })).default([]),
});

export type Requirements = z.infer<typeof RequirementsSchema>;

// ── Architecture ───────────────────────────────────────

export const ArchitectureSchema = z.object({
  version: z.number().int().positive(),
  requirements_version: z.number().int().positive(),
  summary: z.string(),
  files_to_modify: z.array(z.string()).default([]),
  files_to_create: z.array(z.string()).default([]),
  approach: z.string(),
  risks: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;

// ── Review ─────────────────────────────────────────────

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const ReviewFindingSchema = z.object({
  id: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  evidence: z.string().optional(),
  recommendation: z.string().optional(),
  category: z.string().optional(),
});

export const ReviewSchema = z.object({
  version: z.number().int().positive(),
  findings: z.array(ReviewFindingSchema).default([]),
  summary: z.string().optional(),
  approved: z.boolean(),
});

export type Review = z.infer<typeof ReviewSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

// ── Verification ───────────────────────────────────────

export const VerificationCommandSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  exit_code: z.number().int(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});

export const VerificationSchema = z.object({
  commands: z.array(VerificationCommandSchema),
  passed: z.boolean(),
  summary: z.string().optional(),
});

export type Verification = z.infer<typeof VerificationSchema>;

// ── Implementation ─────────────────────────────────────

export const ImplementationSchema = z.object({
  files_changed: z.array(z.string()).default([]),
  files_created: z.array(z.string()).default([]),
  files_deleted: z.array(z.string()).default([]),
  summary: z.string().optional(),
});

export type Implementation = z.infer<typeof ImplementationSchema>;

// ── Artifact union ─────────────────────────────────────

export const ArtifactKindSchema = z.enum([
  'discovery',
  'requirements',
  'architecture',
  'implementation',
  'review',
  'verification',
  'findings',
]);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
