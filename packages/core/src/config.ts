import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { ProjectConfig, ProjectConfigSchema } from '@volibear/contracts';
import { formatZodIssues } from './errors.js';

export interface ConfigOptions {
  projectDir?: string;
  globalDir?: string;
  overrides?: Partial<ProjectConfig>;
}

/**
 * Resolve project config dir (.volibear/ inside project root)
 */
export function resolveProjectDir(cwd?: string): string {
  return resolve(cwd || process.cwd(), '.volibear');
}

/**
 * Resolve global config dir (~/.volibear/)
 */
export function resolveGlobalDir(): string {
  return resolve(homedir(), '.volibear');
}

/**
 * Load YAML/JSON config file.
 * Returns null when the file does not exist; throws with a clear message when
 * the file exists but cannot be parsed — a broken config must never be
 * silently replaced by defaults.
 */
export async function loadConfigFile(filePath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(filePath)) return null;
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `cannot read config file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      const yaml = await requireYaml();
      const parsed = yaml.load(content);
      if (parsed === null || parsed === undefined) return {};
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config must be a YAML mapping (key: value)');
      }
      return parsed as Record<string, unknown>;
    }
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid config file ${filePath}: ${message}`);
  }
}

async function requireYaml() {
  try {
    const { load } = await import('js-yaml');
    return { load };
  } catch {
    throw new Error(
      'js-yaml is required to load YAML config files. Install it: pnpm add js-yaml'
    );
  }
}

/**
 * Load project configuration with the proper precedence:
 *   1. CLI overrides (highest)
 *   2. Project config (.volibear/config.yaml)
 *   3. Global config (~/.volibear/config.yaml)
 *   4. Defaults (lowest)
 */
export async function loadConfig(options: ConfigOptions = {}): Promise<ProjectConfig> {
  const projectDir = options.projectDir || resolveProjectDir();
  const globalDir = options.globalDir || resolveGlobalDir();

  const projectConfigFile = join(projectDir, 'config.yaml');
  const globalConfigFile = join(globalDir, 'config.yaml');

  let projectRaw: Record<string, unknown> | null;
  let globalRaw: Record<string, unknown> | null;
  try {
    projectRaw = await loadConfigFile(projectConfigFile);
    globalRaw = await loadConfigFile(globalConfigFile);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : `config error: ${String(err)}`,
    );
  }

  // Merge with precedence: defaults < global < project < overrides
  let merged: Record<string, unknown>;
  try {
    merged = deepMerge(
      {},
      ProjectConfigSchema.parse({}),            // defaults
      globalRaw || {},                          // global config
      projectRaw || {},                         // project config
      options.overrides || {},                  // CLI overrides (highest)
    );
    return ProjectConfigSchema.parse(merged);
  } catch (err) {
    throw new Error(`invalid configuration: ${formatZodIssues(err)}`);
  }
}

/**
 * Ensure config directories exist.
 */
export function ensureConfigDirs(cwd?: string): { projectDir: string; globalDir: string } {
  const projectDir = resolveProjectDir(cwd);
  const globalDir = resolveGlobalDir();

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, 'agents'), { recursive: true });
  mkdirSync(join(projectDir, 'pipelines'), { recursive: true });
  mkdirSync(join(projectDir, '.runs'), { recursive: true });
  mkdirSync(globalDir, { recursive: true });

  return { projectDir, globalDir };
}

/**
 * Shallow-simple deep merge (handles nested objects, arrays are replaced).
 */
function deepMerge(...sources: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = deepMerge(
          (result[key] as Record<string, unknown>) || {},
          value as Record<string, unknown>,
        );
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}