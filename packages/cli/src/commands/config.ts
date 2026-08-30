import { CliOptions } from '../cli.js';
import { App } from '../app.js';

/**
 * volibear config — show the resolved configuration (defaults < global <
 * project < CLI flags) and where it came from.
 */
export async function runConfig(_positional: string[], options: CliOptions): Promise<number> {
  const app = await App.create(process.cwd(), options);
  console.log(`Config source: ${app.configSource}`);
  console.log(`Project dir:   ${app.projectDir}`);
  console.log('');
  console.log(JSON.stringify(app.config, null, 2));
  return 0;
}
