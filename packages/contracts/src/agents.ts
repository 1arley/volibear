import { z } from 'zod';

// ── Agent role definitions ─────────────────────────────

export const AgentIdSchema = z.enum([
  'rubberduck',
  'architect',
  'developer',
  'reviewer',
  'fixer',
  'verifier',
]);

export type AgentId = z.infer<typeof AgentIdSchema>;

export const AgentDefinitionSchema = z.object({
  id: AgentIdSchema,
  description: z.string(),
  permissions: z.object({
    repository: z.enum(['read', 'write']).default('read'),
    shell: z.enum(['denied', 'read-only', 'full']).default('denied'),
    tests: z.boolean().default(false),
    network: z.boolean().default(false),
  }),
  executor: z.string().default('mock'),
  router: z.string().default('native'),
  model: z.string().optional(),
  instructions_path: z.string().optional(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ── Built-in agent registry ────────────────────────────

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'rubberduck',
    description: 'Clarify and lock intent before architecture',
    permissions: { repository: 'read', shell: 'denied', tests: false, network: false },
    executor: 'mock',
    router: 'native',
  },
  {
    id: 'architect',
    description: 'Design implementation from locked requirements',
    permissions: { repository: 'read', shell: 'denied', tests: false, network: false },
    executor: 'mock',
    router: 'native',
  },
  {
    id: 'developer',
    description: 'Implement the approved architecture',
    permissions: { repository: 'write', shell: 'full', tests: true, network: false },
    executor: 'mock',
    router: 'native',
  },
  {
    id: 'reviewer',
    description: 'Review implementation and produce findings',
    permissions: { repository: 'read', shell: 'denied', tests: false, network: false },
    executor: 'mock',
    router: 'native',
  },
  {
    id: 'fixer',
    description: 'Resolve review findings without redesigning',
    permissions: { repository: 'write', shell: 'full', tests: true, network: false },
    executor: 'mock',
    router: 'native',
  },
  {
    id: 'verifier',
    description: 'Run deterministic project checks',
    permissions: { repository: 'read', shell: 'full', tests: true, network: false },
    executor: 'mock',
    router: 'native',
  },
];
