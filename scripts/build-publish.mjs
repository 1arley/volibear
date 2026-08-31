#!/usr/bin/env node
// Builds a self-contained publishable bundle for the `volibearq` package.
//
// The repo is a pnpm workspace whose real CLI lives in packages/cli. Publishing
// the workspace root as-is yields a package with no `bin` and no compiled code,
// so `npx volibearq` fails with "could not determine executable to run".
//
// This script fixes that by bundling the CLI plus every @volibear/* workspace
// package and its runtime deps (zod, js-yaml) into a single ESM file, and by
// copying the bundled pipeline resources next to it.
//
// Output layout (matches bundledPipelinesDir()/bundledAgentsDir()/
// bundledInstallDir() in packages/cli/src/app.ts, which resolves
// <pkgRoot>/resources/{pipelines,agents,install} from dist/index.js):
//   dist/index.js          bundled CLI entry (with shebang)
//   resources/pipelines/*  default pipeline definitions
//   resources/agents/*     default agent instruction files
//   resources/install/*    native coding-CLI bridge templates

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, chmodSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cliPkg = join(root, 'packages', 'cli');
const pkg = (name) => join(root, 'packages', name, 'src', 'index.ts');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

rmSync(join(root, 'dist'), { recursive: true, force: true });
rmSync(join(root, 'resources'), { recursive: true, force: true });

await build({
  entryPoints: [join(cliPkg, 'src', 'index.ts')],
  outfile: join(root, 'dist', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Workspace packages are source-only; alias them straight to their entry so
  // the bundle does not depend on a prior per-package build.
  alias: {
    '@volibear/contracts': pkg('contracts'),
    '@volibear/core': pkg('core'),
    '@volibear/runtime': pkg('runtime'),
    '@volibear/executors': pkg('executors'),
  },
  // Each workspace package owns its own node_modules; resolve from there.
  nodePaths: [join(cliPkg, 'node_modules'), join(root, 'node_modules')],
  // Single source of truth for `volibearq --version` is the manifest.
  define: { __VOLIBEAR_VERSION__: JSON.stringify(manifest.version) },
  logLevel: 'info',
});

mkdirSync(join(root, 'resources'), { recursive: true });
cpSync(join(cliPkg, 'resources', 'pipelines'), join(root, 'resources', 'pipelines'), {
  recursive: true,
});
cpSync(join(cliPkg, 'resources', 'agents'), join(root, 'resources', 'agents'), {
  recursive: true,
});
cpSync(join(cliPkg, 'resources', 'install'), join(root, 'resources', 'install'), {
  recursive: true,
});

chmodSync(join(root, 'dist', 'index.js'), 0o755);

const bundled = readdirSync(join(root, 'resources', 'pipelines'));
const agents = readdirSync(join(root, 'resources', 'agents'));
const install = readdirSync(join(root, 'resources', 'install'));
console.log(
  `bundle ready: dist/index.js + resources/pipelines (${bundled.join(', ')}) + resources/agents (${agents.join(', ')}) + resources/install (${install.join(', ')})`,
);
