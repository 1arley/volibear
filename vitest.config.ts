import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Tests always run against workspace SOURCES, never stale dist builds.
export default defineConfig({
  resolve: {
    alias: {
      '@volibear/contracts': resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@volibear/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@volibear/runtime': resolve(__dirname, 'packages/runtime/src/index.ts'),
      '@volibear/executors': resolve(__dirname, 'packages/executors/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    globals: true,
  },
});
