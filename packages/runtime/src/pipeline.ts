import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pipeline, PipelineSchema, Stage, AgentDefinition } from '@volibear/contracts';

/**
 * Pipeline parser — loads pipeline definitions from YAML/JSON.
 */
export class PipelineParser {
  /**
   * Load a pipeline by name from the project pipelines directory.
   */
  async loadFromDir(name: string, pipelinesDir: string): Promise<Pipeline | null> {
    const candidates = [
      join(pipelinesDir, `${name}.yaml`),
      join(pipelinesDir, `${name}.yml`),
      join(pipelinesDir, `${name}.json`),
    ];
    for (const file of candidates) {
      if (existsSync(file)) {
        return this.parseFile(file);
      }
    }
    return null;
  }

  /**
   * Load a pipeline from an explicit file path.
   */
  async loadFromFile(filePath: string): Promise<Pipeline> {
    return this.parseFile(filePath);
  }

  private async parseFile(filePath: string): Promise<Pipeline> {
    const content = readFileSync(filePath, 'utf-8');
    let raw: unknown;
    if (filePath.endsWith('.json')) {
      raw = JSON.parse(content);
    } else {
      const { load } = await import('js-yaml');
      raw = load(content);
    }
    return PipelineSchema.parse(raw);
  }
}

/**
 * Validate that a pipeline's stage references resolve to known agents.
 */
export function validatePipelineAgents(
  pipeline: Pipeline,
  agents: AgentDefinition[],
): string[] {
  const agentIds = new Set<string>(agents.map((a) => a.id));
  const problems: string[] = [];
  for (const stage of flattenStages(pipeline)) {
    if (stage.type === 'agent') {
      const agentId = stage.agent!;
      if (!agentIds.has(agentId)) {
        problems.push(`stage "${stage.id}" references unknown agent "${agentId}"`);
      }
    }
  }
  return problems;
}

/**
 * Flatten all stages including nested loop stages.
 */
export function flattenStages(pipeline: Pipeline): Stage[] {
  const result: Stage[] = [];
  for (const stage of pipeline.stages) {
    result.push(stage);
    if (stage.type === 'loop') {
      result.push(...stage.stages);
    }
  }
  return result;
}