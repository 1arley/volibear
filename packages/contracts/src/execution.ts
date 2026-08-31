import { z } from 'zod';
import { AgentIdSchema } from './agents.js';

export const ExecutionStatusSchema = z.enum([
  'prepared', 'session_created', 'running', 'completed', 'failed',
  'timed_out', 'cancelled', 'ambiguous',
]);

export const StageExecutionRecordSchema = z.object({
  schema_version: z.literal(1),
  execution_id: z.string().min(1),
  run_id: z.string().min(1),
  stage_id: z.string().min(1),
  role: AgentIdSchema,
  cycle: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  handoff_hash: z.string().min(1),
  status: ExecutionStatusSchema,
  executor: z.string(),
  remote_agent: z.string().optional(),
  session_id: z.string().optional(),
  server_url: z.string().optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  exit_code: z.number().int().optional(),
  artifact_path: z.string().optional(),
  error: z.string().optional(),
});

export type StageExecutionRecord = z.infer<typeof StageExecutionRecordSchema>;

export interface StageHandoff<T = unknown> {
  schema_version: 1;
  run_id: string;
  pipeline: { name: string; version: number };
  stage: { id: string; role: string; cycle: number; attempt: number };
  task: string;
  inputs: T;
  expected_output?: { kind: string; schema_version: number };
  constraints: string[];
}
