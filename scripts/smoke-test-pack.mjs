#!/usr/bin/env node
// Packs the publishable tarball and exercises it exactly the way a stranger
// would: install it into an empty project and run the CLI through npx.
//
// This is the gate that catches the failure mode where the workspace root is
// published without a `bin`, or without compiled output, and `npx volibearq`
// dies with "could not determine executable to run".

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const failures = [];

// A developer's ~/.npmrc (custom registries, allow-scripts, proxies) and the
// npm_config_* variables pnpm injects into lifecycle scripts must not change
// what the smoke test observes. CI runs clean; local runs should match CI.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(npm|pnpm)_config_/i.test(k)),
);

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    env: cleanEnv,
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures.push(label);
    const detail = [err.message, err.stderr].filter(Boolean).join('\n');
    console.error(`  FAIL ${label}`);
    for (const line of detail.split('\n').slice(0, 8)) {
      console.error(`       ${line}`);
    }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- manifest shape -------------------------------------------------------
// These checks fail fast with a readable reason instead of a stack trace,
// because every one of them maps to a distinct npx/install-time symptom.
console.log(`validating manifest for ${manifest.name}@${manifest.version}`);

const binEntries = Object.entries(manifest.bin ?? {});
const binName = binEntries[0]?.[0];

check('package.json declares a bin', () => {
  assert(
    binEntries.length > 0,
    'no "bin" field — npx fails with "could not determine executable to run"',
  );
});
check('bin points at the bundle', () => {
  assert(
    binEntries.every(([, target]) => target === 'dist/index.js'),
    `expected every bin to be dist/index.js, got ${JSON.stringify(manifest.bin)}`,
  );
});
check('package is ESM (the bundle uses import.meta.url)', () => {
  assert(manifest.type === 'module', `missing "type": "module", got ${manifest.type}`);
});
check('files allowlist ships the bundle and the resources', () => {
  const files = manifest.files ?? [];
  assert(files.includes('dist/index.js'), 'files must include dist/index.js');
  assert(files.includes('resources/pipelines'), 'files must include resources/pipelines');
  assert(files.includes('resources/agents'), 'files must include resources/agents');
  assert(files.includes('resources/install'), 'files must include resources/install');
});
check('no workspace protocol leaks into the published manifest', () => {
  const deps = { ...manifest.dependencies, ...manifest.optionalDependencies };
  const bad = Object.entries(deps).filter(([, spec]) => String(spec).startsWith('workspace:'));
  assert(bad.length === 0, `unresolvable deps for npm consumers: ${bad.map(([k]) => k).join(', ')}`);
});

if (!binName) {
  console.error('\ncannot continue: no bin to exercise');
  process.exit(1);
}

// --- bundle + tarball -----------------------------------------------------
console.log(`\nbuilding bundle`);
run('node', ['scripts/build-publish.mjs']);

const packDir = mkdtempSync(join(tmpdir(), 'volibearq-pack-'));
run('npm', ['pack', '--pack-destination', packDir]);
const tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
assert(tarballs.length === 1, `expected one tarball, found: ${tarballs.join(', ')}`);
const tarball = join(packDir, tarballs[0]);

console.log(`inspecting ${tarballs[0]}`);
const entries = run('tar', ['-tzf', tarball]).split('\n').map((l) => l.replace(/^package\//, ''));

check('tarball contains the CLI bundle', () => {
  assert(entries.includes('dist/index.js'), 'dist/index.js missing — bin would not resolve');
});
check('tarball contains bundled pipeline resources', () => {
  for (const name of ['feature', 'fix']) {
    assert(
      entries.includes(`resources/pipelines/${name}.yaml`),
      `resources/pipelines/${name}.yaml missing — install would copy nothing`,
    );
  }
});
check('tarball contains bundled agent instructions', () => {
  assert(
    entries.includes('resources/agents/rubberduck.md'),
    'resources/agents/rubberduck.md missing — agent prompts would run without role instructions',
  );
});
check('tarball contains bundled CLI integration templates', () => {
  for (const name of ['opencode.md', 'claude.md', 'codex.toml']) {
    assert(
      entries.includes(`resources/install/${name}`),
      `resources/install/${name} missing — install would have no bridge template`,
    );
  }
});
check('tarball excludes workspace sources and node_modules', () => {
  const leaked = entries.filter((e) => e.startsWith('packages/') || e.startsWith('node_modules/'));
  assert(leaked.length === 0, `unexpected entries: ${leaked.slice(0, 3).join(', ')}`);
});

// --- clean consumer install ----------------------------------------------
const proj = mkdtempSync(join(tmpdir(), 'volibearq-consumer-'));
// npm refuses to load one file as both user and global config, so use two.
const userRc = join(proj, 'blank-user.npmrc');
const globalRc = join(proj, 'blank-global.npmrc');
writeFileSync(userRc, '');
writeFileSync(globalRc, '');
const isolated = ['--userconfig', userRc, '--globalconfig', globalRc];

console.log(`\ninstalling into clean project ${proj}`);
run('npm', ['init', '-y', ...isolated], { cwd: proj });
run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...isolated, tarball], {
  cwd: proj,
});

// node_modules/.bin/<name> is the exact symlink npx resolves, so running it
// directly exercises the published `bin` field without npx's own config lookup.
const binPath = join(proj, 'node_modules', '.bin', binName);

check(`npm linked node_modules/.bin/${binName}`, () => {
  assert(existsSync(binPath), 'bin not linked — npx reports "could not determine executable"');
});

const cli = (args) => run(binPath, args, { cwd: proj });

check(`${binName} --version reports the manifest version`, () => {
  assert(cli(['--version']) === manifest.version, `expected ${manifest.version}`);
});
check(`${binName} install --project writes config and pipelines`, () => {
  cli(['install', '--project']);
  assert(existsSync(join(proj, '.volibear', 'config.yaml')), '.volibear/config.yaml missing');
  assert(
    existsSync(join(proj, '.volibear', 'pipelines', 'feature.yaml')),
    '.volibear/pipelines/feature.yaml missing — bundled resources not found at runtime',
  );
});
check(`${binName} install --project opencode writes the bridge agent`, () => {
  cli(['install', '--project', 'opencode']);
  const bridge = join(proj, '.opencode', 'agents', 'volibear.md');
  assert(existsSync(bridge), 'bridge agent not created');
  const content = readFileSync(bridge, 'utf-8');
  assert(content.includes('volibear build'), 'bridge template lacks volibear build routing');
  assert(!content.includes('model:'), 'bridge template must not hardcode a model');
});
check(`${binName} build runs the feature pipeline end to end`, () => {
  const out = cli(['build', 'add a health endpoint', '--accept-defaults', '--allow-mock']);
  assert(/PASS/.test(out), `pipeline did not pass:\n${out}`);
});

console.log(
  failures.length === 0
    ? `\nsmoke test passed (${manifest.name}@${manifest.version})`
    : `\nsmoke test failed: ${failures.join(', ')}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
