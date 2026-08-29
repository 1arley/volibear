# Volibear

Portable multi-agent engineering pipeline runtime.

> Agents think. Volibear orchestrates.

Volibear is a deterministic runtime that takes a software task or structured findings from another tool (e.g. ORNN), runs a controlled engineering workflow, and coordinates coding CLIs, models, agents, gates, and verification steps. It is not an agent itself — it is the orchestration layer that decides what runs, in which order, with which permissions.

**Status:** MVP Phase 1 — runtime skeleton, Rubberduck interactive discovery, executor adapters, repair loops, pause/resume, and deterministic gates.

## Table of Contents

- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Architecture](#architecture)
- [Agents](#agents)
- [Executors](#executors)
- [Pipelines](#pipelines)
- [Gates](#gates)
- [Configuration](#configuration)
- [Developing](#developing)

## Quick Start

```bash
# Install the CLI
npx volibear install

# Start a new feature pipeline
npx volibear build "add Google authentication"

# Fix external findings (e.g. from ORNN)
npx volibear fix findings.json

# Resume an interrupted run
npx volibear resume

# Check status
npx volibear status
```

## CLI Usage

```text
Usage: volibear <command> [options]

Commands:
  install                     Install Volibear integrations (project or global)
  build <task>                Start a development pipeline
  fix [findings]              Fix findings through a Volibear pipeline
  resume                      Resume the latest interrupted pipeline
  status                      Show current pipeline status
  review                      Review the current working tree
  update                      Update Volibear agents and integrations
  config                      Manage configuration
  help                        Show available commands and pipelines

Options:
  --executor <name>           Select coding CLI (mock, opencode, codex, claude)
  --router <name>             Select routing layer (native, 9router)
  --pipeline <name>           Select pipeline
  --accept-defaults           Delegate blocking decisions automatically (non-interactive)
  --project                   Install into the current project
  --global                    Install into ~/.volibear/
  --help, -h                  Show help
  --version, -v               Show version
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Pipeline completed with `PASS` |
| 1    | Pipeline failed (`FAIL`) or an error occurred |
| 2    | Pipeline is `BLOCKED`, `WAITING_FOR_USER`, or blocked on non-interactive input |

## Architecture

Volibear is structured as a layered pnpm workspace:

```text
CLI
  ↓  (interfaces)
Volibear Core  (config loader, artifact store, event log, run state)
  ↓  (runtime)
Pipeline Runtime  (pipeline parser, stage runner, orchestrator)
  ↓  (agent runtime)
Rubberduck Session  (strict discovery state machine)
  ↓
Executor Adapters  (OpenCode, Codex, Claude, mock)
  ↓
Coding CLI  →  Router  →  Model
```

### Packages

| Package | Description |
|---------|-------------|
| `@volibear/contracts` | Shared TypeScript/Zod schemas — agents, stages, pipelines, gates, executors, findings, runs, events |
| `@volibear/core` | Config loader with precedence, append-only JSONL event log, artifact store, run state manager |
| `@volibear/runtime` | Pipeline parser, deterministic gates, `RubberduckSession` state machine, `RunOrchestrator` |
| `@volibear/executors` | CLI executor adapters (mock, OpenCode, Codex, Claude) on a shared `CliExecutor` base |
| `volibear-cli` | Terminal CLI entry point with `install`, `build`, `fix`, `resume`, `status` commands |

Key design rules (full list in `docs/architecture-decisions.md`):

1. **Agents think. Volibear orchestrates.** Pipeline control is deterministic runtime code.
2. **Discovery before autonomy.** Architecture cannot begin until all blocking questions are resolved.
3. **Artifacts are the stage boundary.** Stages exchange structured files, not conversation transcripts.
4. **Gates decide progression.** Models produce evidence; runtime gates decide whether work advances.
5. **Executor, router, model, and agent are independent.** Users may mix them freely.
6. **Simple outside, strict inside.** The CLI is `npx volibear install` / `npx volibear build "..."`.
7. **Local files are the persistence layer.** No database required.

## Agents

Each agent is a role with instructions, restrictions, and output expectations. Agent definitions are built-in but can be overridden per-project in config.

| Agent | Purpose | Permissions | Produces |
|-------|---------|-------------|----------|
| **Rubberduck** | Interactive discovery gate — converts human intent into a locked spec | Read repo, no shell, no implementation, no architecture | `requirements.json`, `requirements.lock` |
| **Architect** | Design the implementation from locked requirements | Read repo, no write, no shell | `architecture.md`, `architecture.json`, `acceptance.json` |
| **Developer** | Implement the approved architecture | Read/write repo, shell, tests | `implementation.json` |
| **Reviewer** | Review correctness and code quality | Read repo, no write | `review.json` (structured findings) |
| **Fixer** | Resolve review findings without redesigning | Read/write repo, shell, tests | `implementation.json` (updated) |
| **Verifier** | Run deterministic project checks | Read repo, shell, tests | `verification.json` |

Agent instruction files live in `agents/` (e.g. `agents/rubberduck.md`, `agents/architect.md`, etc.).

## Executors

Executor adapters translate agent invocations to coding CLIs. Each declares capabilities (headless, interactive, filesystem, tools, custom_endpoint, structured_output) and is resolved through the `ExecutorRegistry`.

| Executor | Binary | Headless | Capabilities |
|----------|--------|----------|-------------|
| **mock** | (built-in) | Yes | Deterministic stand-in for testing; no LLM required |
| **opencode** | `opencode` | Yes | Headless, interactive, filesystem, tools, custom_endpoint |
| **codex** | `codex` | Yes | Headless, filesystem only |
| **claude** | `claude` | Yes | Headless, filesystem, tools, custom_endpoint |

All CLI executors inherit from `CliExecutor` (`packages/executors/src/base.ts`), which provides:

- Binary detection via PATH
- Async `spawn` with a 20-second timeout (prevents interactive CLIs from blocking the runtime)
- Refusal to run a non-headless executor
- Structured JSON extraction from mixed stdout

Executors can be added without modifying the pipeline core — register a new class on the `ExecutorRegistry`.

## Pipelines

Volibear ships with two default pipelines (in `packages/cli/resources/pipelines/`):

### `feature`

New development from a task:

```text
Rubberduck → Architect → [Developer → Reviewer] loop → Verifier
```

### `fix`

Fixing external findings (e.g. from ORNN):

```text
Rubberduck → Architect → [Fixer → Reviewer] loop → Verifier
```

Both pipelines use a **repair loop** with a configurable maximum of 3 cycles and a `no-findings-above-threshold` gate. The loop replaces the developer with the fixer on cycles after the first.

Pipelines are declarative YAML and can be customized or extended. Custom pipeline stages support: `agent`, `gate`, `command`, `rubberduck`, `verify`, and `loop`.

## Gates

Gates are deterministic, code-driven rules (never model-driven) that decide whether the pipeline may continue:

| Gate | Description |
|------|-------------|
| `blocking-questions-resolved` | All BLOCKING Rubberduck questions are answered |
| `requirements-locked` | `requirements.lock` exists for this run |
| `no-findings-above-threshold` | No review findings at or above the configured severity threshold |
| `repair-cycles-within-limit` | Repair cycle count has not exceeded `max_cycles` |
| `artifacts-exist` | Required artifacts are present |

Gates are registered in `packages/runtime/src/gates.ts` and can be extended by registering new implementations on the `GateRegistry`.

## Configuration

Configuration follows a precedence chain: **CLI flags > project config > global config > defaults**.

```
.volibear/           (project scope, ~/.volibear/ for global)
├── config.yaml      (pipeline, executor, router, agents, verification, repair)
├── agents/          (override built-in agent instructions)
├── pipelines/        (override or extend pipelines)
└── .runs/            (runtime state — gitignored)
```

Example `config.yaml`:

```yaml
version: 1
pipeline: feature
executor: mock
router:
  mode: native
repair:
  max_cycles: 3
  reject_on: [critical, high]
verification:
  commands:
    - npm test
    - npm run lint
    - npm run typecheck
agents:
  rubberduck:
    executor: mock
  architect:
    executor: mock
  developer:
    executor: mock
```

## Run Lifecycle

Each run gets an ID (`run-<uuid-prefix>`) and a persisted directory under `.volibear/.runs/<run-id>/`:

```
run.json          Current run state and stage progress
events.jsonl      Append-only event log
discovery.json    Rubberduck session snapshot
requirements.json  Structured requirements (pre-lock)
requirements.lock Locked spec (post-review)
architecture.md   Human-readable architecture
architecture.json Structured architecture
implementation.json Files changed/created
review.json       Structured findings
verification.json Command results
```

Run states: `CREATED → DISCOVERY → WAITING_FOR_USER → REQUIREMENTS_LOCKED → ARCHITECTURE → IMPLEMENTATION → REVIEW → FIXING → VERIFICATION → PASS|FAIL|BLOCKED`

## Developing

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint
pnpm lint
```

Requires Node.js >= 20 and pnpm >= 9.

## License

Private — see `package.json`.
