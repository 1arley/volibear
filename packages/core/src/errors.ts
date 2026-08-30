/**
 * Volibear error types.
 */
export class VolibearError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'VolibearError';
  }
}

export class BlockingQuestionError extends VolibearError {
  constructor(unresolved: number) {
    super(
      `${unresolved} blocking question(s) remain unanswered. Architect cannot proceed.`,
      'BLOCKING_QUESTIONS_UNRESOLVED',
      { unresolved },
    );
    this.name = 'BlockingQuestionError';
  }
}

export class GateError extends VolibearError {
  constructor(gate: string, reason: string) {
    super(`Gate "${gate}" failed: ${reason}`, 'GATE_FAILED', { gate, reason });
    this.name = 'GateError';
  }
}

export class PipelineError extends VolibearError {
  constructor(stageId: string, reason: string) {
    super(`Pipeline stage "${stageId}" failed: ${reason}`, 'PIPELINE_FAILED', {
      stage: stageId,
      reason,
    });
    this.name = 'PipelineError';
  }
}

/**
 * Format a Zod error as one short human-readable line per issue, instead of
 * dumping raw JSON at the user.
 */
export function formatZodIssues(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}