#!/usr/bin/env node
// Volibear CLI entry point
import { main } from './cli.js';

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((err) => {
  console.error('[volibear] error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
