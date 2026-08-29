import { z } from 'zod';
import { Requirements } from './artifacts.js';

// ── Question types ─────────────────────────────────────

export const QuestionTypeSchema = z.enum(['BLOCKING', 'OPTIONAL', 'INFERABLE']);

export const RubberduckQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: QuestionTypeSchema,
  answer: z.string().optional(),
  answer_source: z.enum(['user', 'delegated']).optional(),
  selected_by: z.string().optional(),
  approved_by_user: z.boolean().optional(),
});

export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type RubberduckQuestion = z.infer<typeof RubberduckQuestionSchema>;

// ── Driver interface ───────────────────────────────────
// The driver is the LLM-backed (or mock) component that produces questions,
// picks delegated defaults, and generates requirements. The session (in the
// runtime) is the deterministic state machine that decides whether questions
// are resolved.

export interface RubberduckDriver {
  readonly id: string;
  /** Generate the questions for a task (with optional external findings). */
  discover(
    task: string,
    context: { findings?: unknown },
  ): Promise<RubberduckQuestion[]>;
  /** Pick a default answer when the user delegates a decision. */
  decide(
    question: RubberduckQuestion,
    task: string,
  ): Promise<{ answer: string; selectedBy: string }>;
  /** Generate structured requirements from resolved questions. */
  generateRequirements(
    task: string,
    questions: RubberduckQuestion[],
  ): Promise<Requirements>;
}

export const RubberduckStateSchema = z.enum([
  'DISCOVERING',
  'QUESTIONS_PENDING',
  'ANSWERS_INCOMPLETE',
  'REVIEW',
  'LOCKED',
]);

export type RubberduckState = z.infer<typeof RubberduckStateSchema>;

export const RubberduckSnapshotSchema = z.object({
  version: z.literal(1),
  state: RubberduckStateSchema,
  task: z.string(),
  questions: z.array(RubberduckQuestionSchema),
  updated_at: z.string().datetime(),
});

export type RubberduckSnapshot = z.infer<typeof RubberduckSnapshotSchema>;

export type RubberduckAnswer =
  | { kind: 'answer'; answer: string }
  | { kind: 'delegate' }
  | { kind: 'pause' };

/** Human interface for Rubberduck. Kept separate from the reasoning driver. */
export interface RubberduckInteraction {
  answer(
    question: RubberduckQuestion,
    remainingBlocking: number,
  ): Promise<RubberduckAnswer>;
  confirmLock(requirements: Requirements): Promise<boolean>;
  close?(): void;
}
