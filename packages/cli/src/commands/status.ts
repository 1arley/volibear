import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';

/**
 * volibear status — show current pipeline status.
 */
export async function runStatus(_positional: string[], _options: CliOptions): Promise<number> {
  const projectDir = resolve(process.cwd(), '.volibear');
  if (!existsSync(projectDir)) {
    console.log('No Volibear project installed. Run: volibear install');
    return 1;
  }

  const app = await App.create(process.cwd());
  const latest = app.runStore.latest();
  if (!latest) {
    console.log('No runs yet.');
    return 0;
  }

  const stateSymbol: Record<string, string> = {
    PASS: '✓',
    FAIL: '✗',
    BLOCKED: '◉',
    WAITING_FOR_USER: '◉',
  };

  const symbol = stateSymbol[latest.state] ?? '○';
  console.log(`Feature: ${latest.task}`);
  console.log('');
  console.log(`Run: ${latest.id} (${latest.state}${symbol})`);
  console.log(`Pipeline: ${latest.pipeline}`);
  if (latest.current_stage) {
    console.log(`Current stage: ${latest.current_stage}`);
  }
  if (latest.error) {
    console.log(`Error: ${latest.error}`);
  }
  console.log('');
  console.log('Stages:');
  for (const stage of latest.completed_stages) {
    console.log(`  ✓ ${stage}`);
  }
  if (latest.current_stage && !latest.completed_stages.includes(latest.current_stage)) {
    console.log(`  ◉ ${latest.current_stage}`);
  }
  return 0;
}
