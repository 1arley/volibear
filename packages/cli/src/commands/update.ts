import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { CliOptions } from '../cli.js';
import { bundledPipelinesDir, bundledAgentsDir } from '../app.js';

/**
 * volibear update — refresh bundled pipelines and agent instructions into the
 * project (or global) .volibear directory. Existing files are only replaced
 * with --force; user customizations are otherwise preserved.
 */
export async function runUpdate(positional: string[], options: CliOptions): Promise<number> {
  const scope = options.global ? 'global' : 'project';
  const targetDir = scope === 'global'
    ? resolve(process.env.HOME || process.env.USERPROFILE || '~', '.volibear')
    : resolve(process.cwd(), '.volibear');

  if (!existsSync(targetDir)) {
    console.error(`No Volibear installation found at ${targetDir}. Run: volibear install`);
    return 1;
  }

  const copied: string[] = [];
  const skipped: string[] = [];

  const copyDir = (source: string, dest: string, filter: (name: string) => boolean) => {
    if (!existsSync(source)) return;
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(source).filter(filter)) {
      const from = resolve(source, name);
      const to = resolve(dest, name);
      if (existsSync(to) && !options.force) {
        skipped.push(name);
        continue;
      }
      writeFileSync(to, readFileSync(from, 'utf-8'), 'utf-8');
      copied.push(name);
    }
  };

  copyDir(bundledPipelinesDir(), resolve(targetDir, 'pipelines'), (n) => /\.(ya?ml|json)$/.test(n));
  copyDir(bundledAgentsDir(), resolve(targetDir, 'agents'), (n) => n.endsWith('.md'));

  console.log(`Volibear updated ${scope} installation at ${targetDir}.`);
  if (copied.length > 0) console.log(`  updated: ${copied.join(', ')}`);
  if (skipped.length > 0) console.log(`  kept (use --force to overwrite): ${skipped.join(', ')}`);
  if (copied.length === 0 && skipped.length === 0) console.log('  nothing to update.');
  return 0;
}
