# Volibear

Portable multi-agent engineering pipeline runtime.

> Agents think. Volibear orchestrates.

Volibear is a deterministic runtime that takes a software task or structured findings from another tool (e.g. ORNN), runs a controlled engineering workflow, and coordinates coding CLIs, models, agents, gates, and verification steps. It is not an agent itself — it is the orchestration layer that decides what runs, in which order, with which permissions.

**Status:** MVP Phase 1 — runtime skeleton, Rubberduck interactive discovery, executor adapters, repair loops, pause/resume, deterministic gates, and native coding-CLI bridge agents (OpenCode, Claude Code, Codex) with an interactive install wizard.

## Table of Contents

- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Coding CLI Integrations](#coding-cli-integrations)
- [Install Modes](#install-modes)
- [Architecture](#architecture)
- [Agents](#agents)
- [Executors](#executors)
- [Pipelines](#pipelines)
- [Gates](#gates)
- [Configuration](#configuration)
- [Developing](#developing)
- [Releasing](#releasing)

## Quick Start

```bash
# Interactive setup — detects OpenCode, Claude Code, and Codex on PATH
npx volibearq@latest install

# Non-interactive (CI / automation)
npx volibearq@latest install --project opencode codex

# Start a new feature pipeline
npx volibearq@latest build "add Google authentication"

# Fix external findings (e.g. from ORNN)
npx volibearq@latest fix findings.json

# Resume an interrupted run
npx volibearq@latest resume

# Check status
npx volibearq@latest status
```

> The npm package is `volibearq`; the installed binaries are `volibearq` and `volibear`.
> `npx volibear` resolves the package name, not the binary — always use `volibearq` with `npx`.

## CLI Usage

```text
Usage: volibear <command> [options]
```

> The npm package is `volibearq`; the installed binaries are `volibearq` and `volibear`.
> `npx volibear` resolves the package name, not the binary — always use `volibearq` with `npx`.

## CLI Usage

```text
Usage: volibear <command> [options]

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
  --force                     Overwrite existing install files / retry a BLOCKED run (resume)
  --project                   Install into the current project
  --global                    Install into ~/.volibear/
  --both                      Install into both project and ~/.volibear/
  --help, -h                  Show help
  --version, -v               Show version
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Pipeline completed with `PASS` |
| 1    | Pipeline failed (`FAIL`) or an error occurred |
| 2    | Pipeline is `BLOCKED`, `WAITING_FOR_USER`, or blocked on non-interactive input |

## Coding CLI Integrations

Volibear can appear as a `volibear` agent/entrypoint inside supported coding CLIs.
The installed agent is a **bridge**: it does not replace or duplicate the CLI's
native agents, and it does not implement work itself — it invokes the Volibear
runtime (`volibear build <task>` / `volibear fix <findings>`) through the CLI's
shell/task tool and reports the pipeline result (`PASS` / `FAIL` / `BLOCKED`).

Supported integrations and their canonical bridge file:

| CLI | Project path | Global path | Format |
|-----|--------------|-------------|--------|
| OpenCode | `.opencode/agents/volibear.md` | `~/.config/opencode/agents/volibear.md` | Markdown + YAML frontmatter (`mode: all`) |
| Claude Code | `.claude/agents/volibear.md` | `~/.claude/agents/volibear.md` | Markdown + YAML frontmatter (`name: volibear`) |
| Codex CLI | `.codex/agents/volibear.toml` | `~/.codex/agents/volibear.toml` | TOML (`developer_instructions`) |

Notes:

- The bridge inherits the model configured in the CLI session; no model is
  hardcoded into the installed file.
- Volibear never edits or deletes agent files other than its own
  `volibear.md` / `volibear.toml` bridge file.
- PATH detection is informational: installation works even if the CLI is not
  installed yet (the bridge becomes useful once you install the CLI later).

## Install Modes

`volibear install` runs two ways:

- **Interactive wizard** (stdin is a TTY and no install flags are given):
  detects OpenCode / Claude Code / Codex on PATH, then guides you through
  scope, integrations, pipelines, default executor, router, overwrite choices,
  and a final confirmation summary. Navigation: `↑`/`↓` move, `Space` toggles
  multi-select, `Enter` confirms, `Esc` goes back / cancels, `Ctrl+C` cancels.
- **Non-interactive** (flags given, or stdin is not a TTY): safe for CI and
  scripts.

```bash
# Project only
volibear install --project
volibear install --project opencode codex

# Global only
volibear install --global claude

# Both project and global
volibear install --both opencode claude

# Legacy positional form
volibear install opencode codex
```

- `--executor` sets the runtime's default executor (the CLI used *inside* the
  pipeline), independent of which bridge agents are installed.
- `--pipeline` selects a single pipeline in non-interactive mode (`feature` /
  `fix`); the wizard allows multi-select.
- **Overwrite protection:** existing `volibear` bridge files and an existing
  `.volibear/config.yaml` are preserved by default. Use `--force` to overwrite
  in non-interactive mode; the wizard asks you to choose per destination.

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
6. **Simple outside, strict inside.** The CLI is `npx volibearq install` / `npx volibearq build "..."`.
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
- Async `spawn` with a configurable hard timeout (`executor_timeout_ms`, default 10 minutes)
- Refusal to run a non-headless executor
- Structured JSON extraction from mixed stdout
- Agent role instructions injected into the prompt (from `.volibear/agents/`, `~/.volibear/agents/`, or the bundled copies)

> **Note:** agent `permissions` are advisory metadata today (passed to the executor
> context and prompt); the runtime does not yet sandbox a real CLI's file/shell access.

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
# executor_timeout_ms: 600000   # hard timeout for executors and verify commands
```

> `install` writes `verification.commands: []` with a comment — a run with no
> verification commands still reports PASS, and the CLI prints a warning. Add
> your project's checks to make PASS meaningful.

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

Requires Node.js >= 20 and pnpm >= 9.### Local commands

```bash
# Bundle the CLI into a single self-contained dist/index.js
pnpm bundle

# Pack, install into a throwaway project, and run the CLI through npx
pnpm smoke
```

`pnpm bundle` inlines every `@volibear/*` workspace package plus `zod` and
`js-yaml` into `dist/index.js`, and copies the default pipelines to
`resources/pipelines/`. Both are gitignored build output — the published
tarball is generated in CI, never committed.

## Releasing

Publishing runs in GitHub Actions (`.github/workflows/release.yml`) using npm
**trusted publishing** — no `NPM_TOKEN` secret exists in the repo.

### One-time setup on npmjs.com

Package → **Settings → Trusted Publisher → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `1arley` |
| Repository | `volibear` |
| Workflow filename | `release.yml` |
| Environment name | *(leave empty unless you uncomment `environment:`)* |
| Allowed actions | `npm publish` |

Then **Settings → Publishing access → Require two-factor authentication and
disallow tokens**. npm does not validate this form when you save it — a typo
only surfaces as `ENEEDAUTH` on the first publish.

### Cutting a release

```bash
npm version patch -m "%s" && git push --follow-tags
```

The tag push triggers the workflow. `verify` runs typecheck, unit tests, and
`pnpm smoke`; `publish` asserts the tag matches `package.json`, that the
version is not already on the registry, then runs `npm publish --provenance`.

To rehearse without publishing, run **Release → Run workflow → dry run** from
the Actions tab.

## License

MIT.
