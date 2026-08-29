import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { ProjectConfig, ProjectConfigSchema } from '@volibear/contracts';

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
 * Load YAML/JSON config file, return parsed object or null.
 */
export async function loadConfigFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      const yaml = await requireYaml();
      return yaml.load(content) as Record<string, unknown>;
    }
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
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

  const projectRaw = await loadConfigFile(projectConfigFile);
  const globalRaw = await loadConfigFile(globalConfigFile);

  // Merge with precedence: defaults < global < project < overrides
  const merged = deepMerge(
    {},
    ProjectConfigSchema.parse({}),            // defaults
    globalRaw || {},                          // global config
    projectRaw || {},                         // project config
    options.overrides || {},                  // CLI overrides (highest)
  );

  return ProjectConfigSchema.parse(merged);
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