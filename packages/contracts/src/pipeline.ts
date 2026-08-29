import { z } from 'zod';

// ── Stage ──────────────────────────────────────────────

export const StageTypeSchema = z.enum([
  'agent',
  'gate',
  'command',
  'rubberduck',
  'verify',
  'loop',
]);

export type StageType = z.infer<typeof StageTypeSchema>;

export const StagePermissionSchema = z.enum([
  'read',
  'write',
  'shell',
  'tests',
  'network',
]);

export const StagePermissionsSchema = z.object({
  repository: z.enum(['read', 'write']).default('read'),
  shell: z.enum(['denied', 'read-only', 'full']).default('denied'),
  tests: z.boolean().default(false),
  network: z.boolean().default(false),
});

// ── Base stage ─────────────────────────────────────────

export const BaseStageSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
});

// ── Agent stage ────────────────────────────────────────

export const AgentStageSchema = BaseStageSchema.extend({
  type: z.literal('agent'),
  agent: z.string().min(1),
  permissions: StagePermissionsSchema.optional(),
});

// ── Gate stage ─────────────────────────────────────────

export const GateStageSchema = BaseStageSchema.extend({
  type: z.literal('gate'),
  gate: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});

// ── Command stage ──────────────────────────────────────

export const CommandStageSchema = BaseStageSchema.extend({
  type: z.literal('command'),
  command: z.string().min(1),
});

// ── Rubberduck stage ───────────────────────────────────

export const RubberduckStageSchema = BaseStageSchema.extend({
  type: z.literal('rubberduck'),
});

// ── Verify stage (deterministic project checks) ────────

export const VerifyStageSchema = BaseStageSchema.extend({
  type: z.literal('verify'),
});

// ── Loop stage (repair loops) ──────────────────────────
// `stages` uses `z.lazy()` to self-reference the full Stage union.
// We explicitly annotate the schema with `z.ZodType<Stage>` to break the
// circular type inference that z.discriminatedUnion would otherwise fail on.

type StageUnion =
  | z.infer<typeof AgentStageSchema>
  | z.infer<typeof GateStageSchema>
  | z.infer<typeof CommandStageSchema>
  | z.infer<typeof RubberduckStageSchema>
  | z.infer<typeof VerifyStageSchema>;

export const LoopStageSchema: z.ZodType<LoopStage> = BaseStageSchema.extend({
  type: z.literal('loop'),
  max_cycles: z.number().int().min(1).default(3),
  gate: z.string().min(1),
  stages: z.array(z.lazy(() => StageSchema as z.ZodType<StageUnion>)).min(1),
  fixer_agent: z.string().default('fixer'),
  on_exhausted: z.enum(['block', 'continue']).default('block'),
}) as z.ZodType<LoopStage>;

export interface LoopStage {
  type: 'loop';
  id: string;
  description?: string;
  max_cycles: number;
  gate: string;
  stages: Stage[];
  fixer_agent: string;
  on_exhausted: 'block' | 'continue';
}

// ── Stage union ────────────────────────────────────────

export const StageSchema: z.ZodType<Stage> = z.discriminatedUnion('type', [
  AgentStageSchema,
  GateStageSchema,
  CommandStageSchema,
  RubberduckStageSchema,
  VerifyStageSchema,
  LoopStageSchema as any,
]);

export type Stage = z.infer<typeof AgentStageSchema>
  | z.infer<typeof GateStageSchema>
  | z.infer<typeof CommandStageSchema>
  | z.infer<typeof RubberduckStageSchema>
  | z.infer<typeof VerifyStageSchema>
  | LoopStage;

// ── Pipeline ───────────────────────────────────────────

export const PipelineSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.number().int().positive().default(1),
  repair: z.object({
    max_cycles: z.number().int().min(1).default(3),
    reject_on: z.array(z.string()).default(['critical', 'high']),
  }).default({ max_cycles: 3, reject_on: ['critical', 'high'] }),
  stages: z.array(StageSchema).min(1),
});

export type Pipeline = z.infer<typeof PipelineSchema>;

// ── Pipeline condition (for branching) ─────────────────

export const PipelineConditionSchema = z.object({
  gate: z.string(),
  true_branch: z.string(),
  false_branch: z.string().optional(),
});

export type PipelineCondition = z.infer<typeof PipelineConditionSchema>;
