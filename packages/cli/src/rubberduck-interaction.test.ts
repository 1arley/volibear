import { describe, expect, it, vi } from 'vitest';
import { SubmittedAnswerInteraction } from './rubberduck-interaction.js';

describe('SubmittedAnswerInteraction', () => {
  it('uses exactly one host-provided answer and then pauses safely', async () => {
    const interaction = new SubmittedAnswerInteraction('Use SQLite');
    const question = { id: 'database', type: 'BLOCKING' as const, text: 'Which database?' };
    expect(await interaction.answer(question, 2)).toEqual({ kind: 'answer', answer: 'Use SQLite' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await interaction.answer(question, 1)).toEqual({ kind: 'pause' });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Rubberduck requires input'));
    error.mockRestore();
  });
});
