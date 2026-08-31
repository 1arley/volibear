import { describe, it, expect } from 'vitest';
import { detectIntegrations, detectedIntegrationIds } from './detection.js';

describe('detectIntegrations', () => {
  it('uses the injected detector to probe each CLI', () => {
    const result = detectIntegrations(() => true);
    expect(result).toHaveLength(3);
    expect(result.every((d) => d.available)).toBe(true);
  });

  it('handles all missing', () => {
    const result = detectIntegrations(() => false);
    expect(result).toHaveLength(3);
    expect(result.every((d) => !d.available)).toBe(true);
  });

  it('returns stable order: opencode, claude, codex', () => {
    const result = detectIntegrations(() => true);
    expect(result.map((d) => d.id)).toEqual(['opencode', 'claude', 'codex']);
  });
});

describe('detectedIntegrationIds', () => {
  it('returns only available IDs in order', () => {
    const result = detectedIntegrationIds([
      { id: 'opencode', command: 'opencode', available: true },
      { id: 'claude', command: 'claude', available: false },
      { id: 'codex', command: 'codex', available: true },
    ]);
    expect(result).toEqual(['opencode', 'codex']);
  });

  it('returns empty when none found', () => {
    const result = detectedIntegrationIds([
      { id: 'opencode', command: 'opencode', available: false },
      { id: 'claude', command: 'claude', available: false },
      { id: 'codex', command: 'codex', available: false },
    ]);
    expect(result).toEqual([]);
  });
});