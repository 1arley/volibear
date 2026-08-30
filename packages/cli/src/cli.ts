import { runInstall } from './commands/install.js';
import { runBuild } from './commands/build.js';
import { runFix } from './commands/fix.js';
import { runStatus } from './commands/status.js';
import { runResume } from './commands/resume.js';
import { runConfig } from './commands/config.js';
import { runUpdate } from './commands/update.js';

const HELP = `Usage: volibear <command> [options]

Commands:
  install                     Install Volibear integrations
  build <task>                Start a development pipeline
  fix [findings]              Fix findings through a Volibear pipeline
  resume                      Resume the latest resumable pipeline
  status                      Show current pipeline status
  update                      Refresh bundled pipelines and agent instructions
  config                      Show the resolved configuration
  help                        Show available commands and pipelines

Options:
  --executor <name>           Select coding CLI (mock, opencode, codex, claude)
  --router <name>             Select routing layer (native, 9router)
  --pipeline <name>           Select pipeline
  --accept-defaults           Delegate blocking decisions automatically (non-interactive)
  --force                     Overwrite existing config (install) / retry a BLOCKED run (resume)
  --project                   Install into the current project
  --global                    Install into ~/.volibear/
  --help, -h                  Show help
  --version, -v               Show version

Exit codes:
  0  PASS                     1  FAIL or error     2  BLOCKED / WAITING_FOR_USER
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
  force?: boolean;
}

export interface ParsedArgs {
  command: string;
  positional: string[];
  options: CliOptions;
  warnings: string[];
  errors: string[];
}


/**
 * Parse CLI arguments into a command + options.
 */
export function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const options: CliOptions = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.verbose = true;
        return { command: 'help', positional: [], options, warnings, errors };
      case '--version':
      case '-v':
        return { command: 'version', positional: [], options, warnings, errors };
      case '--executor':
      case '--router':
      case '--pipeline': {
        const value = args[i + 1];
        if (value === undefined || value.startsWith('--')) {
          errors.push(`${arg} requires a value`);
          i++;
          break;
        }
        i++;
        if (arg === '--executor') options.executor = value;
        if (arg === '--router') options.router = value;
        if (arg === '--pipeline') options.pipeline = value;
        break;
      }
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
      case '--force':
        options.force = true;
        break;
      default:
        if (arg.startsWith('--')) {
          warnings.push(`unknown option "${arg}" ignored`);
        } else {
          positional.push(arg);
        }
    }
  }

  const command = positional.shift() || 'help';
  return { command, positional, options, warnings, errors };
}

/**
 * Main CLI entry.
 */
export async function main(args: string[]): Promise<number> {
  const { command, positional, options, warnings, errors } = parseArgs(args);

  for (const warning of warnings) {
    console.error(`[volibear] warning: ${warning}`);
  }
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[volibear] error: ${error}`);
    }
    console.log(HELP);
    return 1;
  }

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
    case 'config':
      return runConfig(positional, options);
    case 'update':
      return runUpdate(positional, options);
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      return 1;
  }
}
