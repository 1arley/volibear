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