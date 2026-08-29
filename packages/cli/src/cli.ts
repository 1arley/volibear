import { runInstall } from './commands/install.js';
import { runBuild } from './commands/build.js';
import { runFix } from './commands/fix.js';
import { runStatus } from './commands/status.js';
import { runResume } from './commands/resume.js';

const HELP = `Usage: volibear <command> [options]

Commands:
  install                     Install Volibear integrations
  build <task>                Start a development pipeline
  fix [findings]              Fix findings through a Volibear pipeline
  resume                      Resume the current pipeline
  status                      Show current pipeline status
  review                      Review the current working tree
  update                      Update Volibear agents and integrations
  config                      Manage configuration
  help                        Show available commands and pipelines

Options:
  --executor <name>           Select coding CLI
  --router <name>             Select routing layer
  --pipeline <name>           Select pipeline
  --accept-defaults           Delegate blocking decisions (non-interactive)
  --help                      Show help
  --version                   Show version
`;

declare const __VOLIBEAR_VERSION__: string | undefined;

const VERSION =
  typeof __VOLIBEAR_VERSION__ === 'string' ? __VOLIBEAR_VERSION__ : '0.0.0-dev';

export interface CliOptions {
  executor?: string;
  router?: string;
  pipeline?: string;
  project?: boolean;
  global?: boolean;
  verbose?: boolean;
  acceptDefaults?: boolean;
}

/**
 * Parse CLI arguments into a command + options.
 */
export function parseArgs(
  args: string[],
): { command: string; positional: string[]; options: CliOptions } {
  const positional: string[] = [];
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.verbose = true;
        return { command: 'help', positional: [], options };
      case '--version':
      case '-v':
        return { command: 'version', positional: [], options };
      case '--executor':
        options.executor = args[++i];
        break;
      case '--router':
        options.router = args[++i];
        break;
      case '--pipeline':
        options.pipeline = args[++i];
        break;
      case '--project':
        options.project = true;
        break;
      case '--global':
        options.global = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--accept-defaults':
        options.acceptDefaults = true;
        break;
      default:
        if (arg.startsWith('--')) {
          // Unknown option — ignore but warn
          continue;
        }
        positional.push(arg);
    }
  }

  const command = positional.shift() || 'help';
  return { command, positional, options };
}

/**
 * Main CLI entry.
 */
export async function main(args: string[]): Promise<number> {
  const { command, positional, options } = parseArgs(args);

  switch (command) {
    case 'help':
      console.log(HELP);
      return 0;
    case 'version':
      console.log(VERSION);
      return 0;
    case 'install':
      return runInstall(positional, options);
    case 'build':
      return runBuild(positional, options);
    case 'fix':
      return runFix(positional, options);
    case 'status':
      return runStatus(positional, options);
    case 'resume':
      return runResume(positional, options);
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      return 1;
  }
}
