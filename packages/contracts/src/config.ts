import { z } from 'zod';

// ── Agent config entry ─────────────────────────────────

export const AgentConfigSchema = z.object({
  executor: z.string().default('mock'),
  router: z.string().default('native'),
  model: z.string().optional(),
});

// ── Router config ──────────────────────────────────────

export const RouterConfigSchema = z.object({
  mode: z.enum(['native', '9router']).default('native'),
  endpoint: z.string().url().optional(),
  api_key: z.string().optional(),
});

// ── Verification config ────────────────────────────────

export const VerificationConfigSchema = z.object({
  commands: z.array(z.string()).default([]),
});

// ── Repair config ──────────────────────────────────────

export const RepairConfigSchema = z.object({
  max_cycles: z.number().int().min(1).default(3),
  reject_on: z.array(z.string()).default(['critical', 'high']),
});

// ── Executor config ────────────────────────────────────

export const ExecutorConfigSchema = z.object({
  id: z.string(),
  command: z.string().optional(),
  detect: z.object({
    command: z.string(),
  }).optional(),
  capabilities: z.object({
    headless: z.boolean().default(true),
    interactive: z.boolean().default(false),
    filesystem: z.boolean().default(true),
    tools: z.boolean().default(false),
    structured_output: z.boolean().default(false),
  }).default({}),
});

// ── Project config (.volibear/config.yaml) ─────────────

export const ProjectConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  pipeline: z.string().default('feature'),
  executor: z.string().default('mock'),
  router: RouterConfigSchema.default({}),
  agents: z.record(z.string(), AgentConfigSchema).default({}),
  verification: VerificationConfigSchema.default({}),
  repair: RepairConfigSchema.default({ max_cycles: 3, reject_on: ['critical', 'high'] }),
  executors: z.array(ExecutorConfigSchema).default([]),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
