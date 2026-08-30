import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Stage } from '@volibear/contracts';
import { CliOptions } from '../cli.js';
import { App } from '../app.js';

const STATE_SYMBOL: Record<string, string> = {
  PASS: '✓',
  FAIL: '✗',
  BLOCKED: '◉',
  WAITING_FOR_USER: '◉',
};

/**
 * volibear status — show current pipeline status.
 */
export async function runStatus(_positional: string[], options: CliOptions): Promise<number> {
  const projectDir = resolve(process.cwd(), '.volibear');
  if (!existsSync(projectDir)) {
    console.log('No Volibear project installed. Run: volibear install');
    return 1;
  }

  const app = await App.create(process.cwd(), options);
  const runs = app.runStore.list();
  if (runs.length === 0) {
    console.log('No runs yet.');
    return 0;
  }
  const latest = runs[0];

  const symbol = STATE_SYMBOL[latest.state] ?? '○';
  console.log(`Task: ${latest.task}`);
  console.log('');
  console.log(`Run: ${latest.id} (${latest.state}${symbol})`);
  console.log(`Pipeline: ${latest.pipeline}`);
  if (latest.current_stage) {
    console.log(`Current stage: ${latest.current_stage}`);
  }
  if (latest.error) {
    console.log(`Error: ${latest.error}`);
  }

  // Full stage checklist when the pipeline definition is available.
  let stages: Stage[] | null = null;
  try {
    stages = (await app.getPipeline(latest.pipeline)).stages;
  } catch {
    stages = null;
  }

  console.log('');
  console.log('Stages:');
  if (stages) {
    for (const stage of stages) {
      if (latest.completed_stages.includes(stage.id)) {
        console.log(`  ✓ ${stage.id}`);
      } else if (stage.id === latest.current_stage) {
        console.log(`  ◉ ${stage.id}`);
      } else {
        console.log(`  ○ ${stage.id}`);
      }
    }
  } else {
    for (const stage of latest.completed_stages) {
      console.log(`  ✓ ${stage}`);
    }
    if (latest.current_stage && !latest.completed_stages.includes(latest.current_stage)) {
      console.log(`  ◉ ${latest.current_stage}`);
    }
  }
  return 0;
}
