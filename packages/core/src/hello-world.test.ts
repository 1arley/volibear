import { describe, it, expect } from 'vitest';
import { helloWorld } from './hello-world.js';

describe('helloWorld', () => {
  it('returns "Hello, World!"', () => {
    expect(helloWorld()).toBe('Hello, World!');
  });

  it('returns a string', () => {
    expect(typeof helloWorld()).toBe('string');
  });
});
