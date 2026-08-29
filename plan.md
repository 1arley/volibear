# Volibear MVP Plan

## 1. Product Definition

Volibear is a portable multi-agent engineering pipeline runtime.

Its job is to take a development task or structured findings from another tool, run a controlled engineering workflow, and coordinate different coding CLIs, routers, models, agents, gates, and verification steps.

Volibear is not an agent.

Volibear is the deterministic runtime that decides what runs, in which order, with which permissions, using which executor, router, and model.

Core principle:

> Agents think. Volibear orchestrates.

The MVP must prioritize simplicity, portability, strict workflow control, and compatibility with multiple coding CLIs.

---

## 2. Primary MVP Use Case

The initial target workflow is:

1. The user works normally inside a coding CLI such as OpenCode.
2. The user may run `npx ornn-forge` to review the current project using ORNN skills.
3. ORNN produces structured findings.
4. The user invokes Volibear to fix the findings or execute a new development task.
5. Volibear starts an interactive Rubberduck session.
6. Rubberduck asks every blocking question required before architecture begins.
7. Volibear refuses to continue while required questions remain unanswered.
8. Once discovery is locked, Architect designs the solution.
9. Developer implements the architecture.
10. Reviewer inspects the implementation.
11. Fixer resolves findings.
12. Reviewer runs again when necessary.
13. Verifier executes deterministic project checks.
14. The pipeline ends in PASS, FAIL, or BLOCKED.

Example:

```text
OpenCode
   ↓
npx ornn-forge
   ↓
ORNN findings
   ↓
volibear fix
   ↓
Rubberduck
   ↓
requirements.lock
   ↓
Architect
   ↓
Developer
   ↓
Reviewer
   ↓
Fixer
   ↓
Reviewer
   ↓
Verifier
   ↓
PASS / FAIL / BLOCKED
```

---

## 3. MVP Goals

The MVP must prove that Volibear can:

- run a complete multi-agent engineering pipeline
- remain independent from any single coding CLI
- support different models for different agents
- support 9Router as an optional routing layer
- run from the terminal and from inside supported coding CLIs
- integrate with ORNN without depending on ORNN
- persist pipeline state
- stop and resume an interrupted pipeline
- enforce blocking questions before architecture
- enforce agent permissions
- enforce deterministic gates
- repeat review/fix cycles safely
- finish with deterministic verification

---

## 4. Non-Goals for MVP

Do not build these in the first MVP:

- Web UI
- graphical pipeline builder
- tray application
- distributed workers
- remote execution
- cloud account system
- team collaboration
- marketplace
- dozens of built-in pipelines
- complex plugin SDK
- automatic model benchmarking
- background daemon
- advanced telemetry
- visual DAG editor

The architecture should not prevent these features later.

---

## 5. Core Concepts

The MVP has seven core concepts.

### Agent

A role with instructions, restrictions, permissions, and output expectations.

Examples:

- Rubberduck
- Architect
- Developer
- Reviewer
- Fixer
- Verifier

### Stage

One executable step in a pipeline.

A stage references an agent or deterministic command.

### Artifact

Structured information passed between stages.

Examples:

- findings.json
- discovery.json
- requirements.json
- architecture.md
- implementation.json
- review.json
- verification.json

### Gate

A deterministic rule that decides whether the pipeline may continue.

Examples:

- all blocking questions answered
- no critical review findings
- tests passed
- build passed

### Executor

The coding CLI used to run an agent.

Examples:

- OpenCode
- Codex
- Claude Code
- Gemini CLI
- Aider

### Router

Optional model routing layer.

Initial options:

- native
- 9Router

### Run

A persisted execution of one pipeline.

---

## 6. Architectural Rule

CLI is not the core.

Volibear must be structured as:

```text
Interfaces
    ↓
Volibear Core
    ↓
Pipeline Runtime
    ↓
Agent Runtime
    ↓
Executor Adapter
    ↓
Coding CLI
    ↓
Router
    ↓
Model
```

Possible interfaces:

```text
Terminal CLI
OpenCode integration
Codex integration
Claude Code integration
future Web UI
future TUI
future CI integration
```

The same run must belong to Volibear, not to the interface that started it.

---

## 7. Default MVP Pipeline

The MVP ships with one primary pipeline:

`feature`

Flow:

```text
Rubberduck
    ↓
Architect
    ↓
Developer
    ↓
Reviewer
    ↓
issues?
  yes  no
   ↓    ↓
 Fixer  Verifier
   ↓
 Reviewer
   ↓
 Verifier
```

The same pipeline can also receive external findings.

For example:

```text
ORNN findings
     ↓
Rubberduck
     ↓
Architect
     ↓
Developer/Fixer
     ↓
Reviewer
     ↓
Verifier
```

---

## 8. Rubberduck Specification

Rubberduck is not a normal agent stage.

Rubberduck is an interactive discovery gate.

Its purpose is to convert human intent into a locked engineering specification.

### Required behavior

Rubberduck must:

- inspect the task
- inspect external findings when provided
- inspect relevant repository context
- identify ambiguous requirements
- identify decisions that materially affect implementation
- ask as many questions as necessary
- classify questions
- track answers individually
- refuse to continue while blocking questions remain unanswered
- allow the user to delegate a decision
- generate structured requirements
- require final lock before architecture starts

### Question types

Every question must be classified as:

```text
BLOCKING
OPTIONAL
INFERABLE
```

`BLOCKING`

Architecture cannot begin without an answer.

`OPTIONAL`

Useful clarification but not required.

`INFERABLE`

Rubberduck may choose a default if the user allows it.

### Strict answer tracking

Example:

Rubberduck asks:

```text
Q1. Should accounts with the same verified email be merged?
Q2. Can the migration cause downtime?
Q3. Must existing sessions remain valid?
```

User answers:

```text
No downtime.
```

Volibear must track:

```text
Q1 unresolved
Q2 answered
Q3 unresolved
```

Rubberduck responds only with the unresolved required questions.

It must not silently infer that the user answered everything.

### Delegated decisions

The user may answer:

```text
Q1 decide for me
```

Volibear records:

```json
{
  "question": "Q1",
  "answer_source": "delegated",
  "selected_by": "rubberduck",
  "approved_by_user": true
}
```

### Rubberduck state machine

```text
DISCOVERING
    ↓
QUESTIONS_PENDING
    ↓
ANSWERS_INCOMPLETE
    ↓
REVIEW
    ↓
LOCKED
```

Architect cannot run before:

```text
state = LOCKED
```

### Discovery output

Rubberduck produces:

```text
requirements.json
requirements.lock
```

At minimum:

```json
{
  "version": 1,
  "task": "...",
  "decisions": [],
  "assumptions": [],
  "constraints": [],
  "acceptance_intent": [],
  "unresolved": []
}
```

The runtime, not the language model, decides whether unresolved blocking questions remain.

---

## 9. Requirements Lock

Once discovery is approved:

```text
requirements.lock
```

is created.

The Architect works against this locked specification.

If the user changes a locked requirement later, Volibear must invalidate downstream assumptions.

Example:

```text
requirements v1
   ↓
architecture v1
   ↓
user changes requirement
   ↓
requirements v2
   ↓
architecture becomes stale
```

For the MVP, the safe default is:

```text
require architecture to run again
```

---

## 10. Built-in Agents

### Rubberduck

Purpose:

Clarify and lock intent.

Permissions:

```text
repository read
repository write denied
shell denied
network configurable
implementation denied
architecture denied
```

Default model is user-configurable.

Example:

```text
GPT-5.6 Luna
```

### Architect

Purpose:

Design the implementation from locked requirements and repository context.

Permissions:

```text
repository read
repository write denied
shell read-only or denied
```

Produces:

```text
architecture.md
acceptance.json
risks.json
```

Example model:

```text
GPT-5.6 Terra
```

### Developer

Purpose:

Implement the approved architecture.

Permissions:

```text
repository read
repository write
shell
tests
```

Example models:

```text
MiMo 2.5
DeepSeek V4 Flash
```

### Reviewer

Purpose:

Review correctness and code quality after implementation.

Permissions:

```text
repository read
repository write denied
shell optional
```

Produces structured findings.

Example model:

```text
GLM-5.2
```

### Fixer

Purpose:

Resolve approved review findings without silently redesigning the architecture.

Permissions:

```text
repository read
repository write
shell
tests
```

Example model:

```text
DeepSeek V4 Flash
```

### Verifier

Purpose:

Run deterministic verification.

Verifier is preferably command-driven rather than model-driven.

Examples:

```text
tests
lint
typecheck
build
integration tests
```

Verifier must not edit application code.

---

## 11. Agent, Executor, Router, and Model Must Be Separate

Never hardcode a model into an agent definition.

These are independent concepts:

```text
Agent
Executor
Router
Model
```

Example:

```yaml
agents:
  rubberduck:
    executor: opencode
    router: 9router
    model: gpt-5.6-luna

  architect:
    executor: codex
    router: 9router
    model: gpt-5.6-terra

  developer:
    executor: opencode
    router: 9router
    model: deepseek-v4-flash

  reviewer:
    executor: opencode
    router: 9router
    model: glm-5.2

  fixer:
    executor: opencode
    router: 9router
    model: deepseek-v4-flash
```

The user must be able to replace any of these independently.

---

## 12. 9Router Integration

9Router is a first-class optional router.

Volibear must not depend on it.

Supported modes:

```yaml
routing:
  mode: native
```

or:

```yaml
routing:
  mode: 9router
```

The executor adapter is responsible for translating router configuration into the selected coding CLI.

Conceptually:

```text
Volibear
   ↓
Executor Adapter
   ↓
OpenCode / Codex / Claude / ...
   ↓
9Router or Native
   ↓
Model
```

---

## 13. Coding CLI Support

The MVP should support at least:

- OpenCode
- Codex
- Claude Code

The architecture must support adding:

- Gemini CLI
- Aider
- Qwen CLI
- Crush
- other coding CLIs

without modifying the pipeline core.

### Adapter contract

Each executor declares capabilities.

Example:

```yaml
id: opencode

detect:
  command: opencode --version

capabilities:
  headless: true
  interactive: true
  filesystem: true
  tools: true
  custom_endpoint: true
  structured_output: true
```

Simple executors may use declarative adapters.

Executors requiring custom behavior may use TypeScript adapters.

---

## 14. ORNN Integration

Volibear must integrate with ORNN without importing ORNN as a hard dependency.

Expected workflow:

```text
npx ornn-forge
   ↓
review
   ↓
structured findings
   ↓
volibear fix
```

Volibear should define a generic finding contract.

Example:

```json
{
  "findings": [
    {
      "id": "F001",
      "severity": "high",
      "title": "Concurrent request can create duplicate records",
      "file": "src/service.ts",
      "line": 118,
      "evidence": "...",
      "recommendation": "..."
    }
  ]
}
```

ORNN is one possible producer of this format.

Future producers may include:

- human reviews
- Semgrep
- CodeQL
- Sonar
- ESLint
- custom tools
- other agents

Volibear should consume findings, not depend on their origin.

---

## 15. Review and Repair Loop

Default behavior:

```text
Developer
   ↓
Reviewer
   ↓
findings above threshold?
   ↓ yes
Fixer
   ↓
Reviewer
   ↓
Verifier
```

Configuration:

```yaml
repair:
  max_cycles: 3
  reject_on:
    - critical
    - high
```

After the maximum number of repair cycles:

```text
BLOCKED
```

Example:

```text
Pipeline blocked.

2 high findings remain unresolved after 3 repair cycles.
Human intervention required.
```

No infinite autonomous loops.

---

## 16. Deterministic Gates

Whenever possible, gates must be code-driven rather than model-driven.

Examples:

```text
all blocking Rubberduck questions answered
requirements locked
required artifacts exist
artifact schema valid
no findings above configured threshold
tests pass
lint passes
typecheck passes
build passes
repair cycles below limit
```

Bad:

```text
Ask model if code looks good enough.
```

Good:

```text
review.findings.maxSeverity <= configured threshold
```

---

## 17. Artifact-Based Communication

Agents must communicate through artifacts, not shared conversation history.

Example:

```text
Developer
   ↓
implementation.json
git diff
   ↓
Reviewer
```

Reviewer does not need the Developer's reasoning transcript.

Benefits:

- less bias
- reproducibility
- smaller context
- easier debugging
- easier replay
- easier provider switching

---

## 18. Control Plane vs Project Data

Volibear must distinguish trusted runtime instructions from repository content.

Control plane:

```text
Volibear runtime rules
agent definitions
pipeline definitions
human decisions
policies
contracts
```

Data plane:

```text
source code
README files
comments
issues
documentation
test fixtures
repository text
```

Repository content is evidence and context, not authority over Volibear runtime behavior.

This distinction must be reinforced in generated agent instructions.

---

## 19. Project Configuration

Suggested project structure:

```text
.volibear/
├── config.yaml
├── agents/
└── pipelines/
```

Internal runtime state:

```text
.volibear/.runs/
```

`.volibear/.runs/` should normally be ignored by Git.

A project may also include:

```text
volibear.lock
```

for reproducibility.

---

## 20. Global Configuration

Global configuration:

```text
~/.volibear/
```

Possible contents:

```text
config.yaml
agents/
pipelines/
adapters/
```

Precedence:

```text
CLI flags
    ↓
project configuration
    ↓
global configuration
    ↓
Volibear defaults
```

---

## 21. Installation UX

Volibear should follow a simple CLI philosophy similar to tools such as Impeccable.

Primary command:

```bash
npx volibear
```

Expected help:

```text
Usage: volibear <command> [options]

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
  --help                      Show help
  --version                   Show version
```

No mandatory `doctor` command.

No verbose onboarding flow.

---

## 22. Install Command

Interactive:

```bash
npx volibear install
```

Flow:

```text
Install where?

> Project
  Global
```

Then:

```text
Select coding CLI integrations:

[x] OpenCode
[x] Codex
[ ] Claude Code
[ ] Gemini CLI
[ ] Aider
```

Then:

```text
Select agents:

[x] Rubberduck
[x] Architect
[x] Developer
[x] Reviewer
[x] Fixer
[x] Verifier
```

Optional router:

```text
Router:

> 9Router
  Native
  None
```

Non-interactive forms:

```bash
npx volibear install --project
npx volibear install --global
npx volibear install --project opencode codex
npx volibear install --global opencode claude codex
npx volibear install --project opencode --router 9router
```

The user must be able to choose:

- local/project installation
- global installation
- which coding CLIs receive integrations
- which Volibear agents are installed
- which router is preferred

---

## 23. OpenCode MVP Experience

OpenCode is the highest-priority interactive integration.

The user may work normally inside OpenCode.

Example:

```text
> npx ornn-forge
```

ORNN reviews the project.

Then:

```text
> /volibear fix
```

or:

```text
> npx volibear fix
```

Volibear starts the Rubberduck conversation in the current interface.

Example:

```text
Rubberduck

I need 4 decisions before architecture.

Q1 ...
Q2 ...
Q3 ...
Q4 ...
```

After all blocking questions are resolved:

```text
Requirements locked.

Architect      GPT-5.6 Terra
Developer      DeepSeek V4 Flash
Reviewer       GLM-5.2
Fixer          DeepSeek V4 Flash
Verifier       project commands
```

The same Volibear run should be resumable from the terminal if necessary.

---

## 24. CLI Daily Workflow

New task:

```bash
npx volibear build "add Google authentication"
```

Fix external findings:

```bash
npx volibear fix findings.json
```

Resume:

```bash
npx volibear resume
```

Status:

```bash
npx volibear status
```

Standalone review:

```bash
npx volibear review
```

Expected status output should remain concise:

```text
Feature: Google authentication

✓ Discovery
✓ Architecture
◉ Implementation
○ Review
○ Verification
```

---

## 25. Run Persistence

Each run gets an ID.

Example:

```text
.volibear/.runs/01KXYZ/
```

Suggested contents:

```text
run.json
events.jsonl
requirements.json
requirements.lock
architecture.md
acceptance.json
implementation.json
review.json
verification.json
```

Minimum run states:

```text
CREATED
DISCOVERY
WAITING_FOR_USER
REQUIREMENTS_LOCKED
ARCHITECTURE
IMPLEMENTATION
REVIEW
FIXING
VERIFICATION
PASS
FAIL
BLOCKED
```

---

## 26. Events

The MVP should record meaningful runtime events.

Example:

```json
{"event":"run.started"}
{"event":"rubberduck.question.created","id":"Q1"}
{"event":"rubberduck.question.answered","id":"Q1"}
{"event":"requirements.locked","version":1}
{"event":"stage.started","stage":"architect"}
{"event":"stage.completed","stage":"architect"}
{"event":"review.rejected","severity":"high"}
{"event":"repair.started","cycle":1}
{"event":"verification.completed","status":"pass"}
{"event":"run.completed","status":"pass"}
```

This will make future resume, Web UI, TUI, and replay features much easier.

---

## 27. Verification

Verifier must use project commands.

Example config:

```yaml
verification:
  commands:
    - npm test
    - npm run lint
    - npm run typecheck
    - npm run build
```

Commands may be detected initially but must be configurable.

A run cannot report PASS when a required verification command fails.

---

## 28. Suggested Repository Structure

```text
volibear/
├── packages/
│   ├── cli/
│   ├── core/
│   ├── runtime/
│   ├── contracts/
│   └── executors/
│       ├── opencode/
│       ├── codex/
│       └── claude/
│
├── agents/
│   ├── rubberduck.md
│   ├── architect.md
│   ├── developer.md
│   ├── reviewer.md
│   ├── fixer.md
│   └── verifier.md
│
├── pipelines/
│   └── feature.yaml
│
├── contracts/
│   ├── findings.schema.json
│   ├── discovery.schema.json
│   ├── requirements.schema.json
│   ├── architecture.schema.json
│   ├── review.schema.json
│   └── verification.schema.json
│
├── adapters/
│   ├── opencode.yaml
│   ├── codex.yaml
│   └── claude.yaml
│
├── tests/
├── package.json
├── README.md
└── plan.md
```

---

## 29. Suggested Technical Stack

For the MVP:

```text
TypeScript
Node.js
pnpm
Zod or JSON Schema validation
YAML configuration
child_process / execa for CLI execution
Git for repository state
JSONL for event logging
```

Avoid introducing a database in the MVP.

Local files are enough.

---

## 30. MVP Implementation Phases

### Phase 1: Runtime Skeleton

Build:

- CLI package
- project/global config loader
- pipeline parser
- run state
- artifact store
- event log
- stage runner
- deterministic gates
- mock executor

Success condition:

A fake pipeline can run end-to-end without any LLM.

### Phase 2: Rubberduck

Build:

- interactive session
- question schema
- blocking/optional/inferable types
- answer tracking
- delegated decisions
- state machine
- requirements generation
- requirements lock

Success condition:

Rubberduck cannot release Architect while any blocking question remains unresolved.

### Phase 3: Executor Adapters

Implement:

- OpenCode
- Codex
- Claude Code

Success condition:

The same simple agent can run through any supported executor without changing pipeline logic.

### Phase 4: 9Router

Add:

- router config
- custom endpoint/model mapping
- per-agent router selection

Success condition:

Two agents in one pipeline can use different models through 9Router.

### Phase 5: Engineering Agents

Implement:

- Architect
- Developer
- Reviewer
- Fixer
- Verifier

Success condition:

A small real feature can go from locked discovery to verified implementation.

### Phase 6: Review Loop

Implement:

- structured review findings
- severity gates
- repair cycles
- max repair cycles
- BLOCKED state

Success condition:

Reviewer can reject, Fixer can repair, Reviewer can run again, and the runtime stops safely.

### Phase 7: ORNN Findings Input

Implement generic:

```bash
volibear fix findings.json
```

Add ORNN-compatible finding import.

Success condition:

Output from `npx ornn-forge` can feed Volibear without Volibear importing ORNN internals.

### Phase 8: Installation UX

Implement:

```bash
npx volibear install
```

Support:

- project/global scope
- selectable CLI integrations
- selectable agents
- selectable router
- non-interactive flags

Success condition:

A user can install Volibear into OpenCode, Codex, or Claude with one short command flow.

---

## 31. MVP Acceptance Criteria

The MVP is ready when all of these work:

### Installation

```bash
npx volibear install
```

can install locally or globally.

The user can select coding CLI integrations.

### OpenCode

Volibear can be invoked from inside OpenCode.

### New task

```bash
npx volibear build "implement feature X"
```

starts Rubberduck.

### Strict Rubberduck

If three blocking questions are asked and the user answers one, Volibear reports the remaining two and refuses to start Architect.

### Per-agent models

Different agents can use different configured models.

### 9Router

At least one complete pipeline can execute through 9Router.

### Multiple executors

At least OpenCode, Codex, and Claude Code adapters work.

### Architecture

Architect receives locked requirements and repository context.

### Implementation

Developer modifies the repository.

### Review

Reviewer returns structured findings.

### Repair

Fixer resolves findings and can trigger another review cycle.

### Verification

Required project commands run deterministically.

### Termination

Pipeline ends as:

```text
PASS
FAIL
BLOCKED
```

### ORNN

Volibear can consume structured findings originating from ORNN.

### Resume

An interrupted Rubberduck or pipeline run can be resumed.

---

## 32. Future Roadmap

Not part of MVP.

### Web UI

A local browser interface similar in spirit to 9Router.

Possible launch flow:

```text
Choose Interface

★ Web UI
☆ Terminal UI
☆ Hide to Tray
☆ Exit
```

Web UI should eventually allow users to:

- create pipelines
- reorder agents
- add and remove stages
- configure gates
- configure repair loops
- choose executor per agent
- choose router per agent
- choose model per agent
- edit agent instructions
- configure permissions
- manage integrations
- manage local/global scope
- answer Rubberduck questions
- inspect runs
- inspect artifacts
- inspect findings
- watch pipeline progress

Critical design rule:

The Web UI edits declarative Volibear configuration.

It must not create a hidden configuration database that cannot be represented in project files.

### TUI

Optional terminal interface for the same runtime.

### Pipeline Builder

Visual DAG editor.

### More Executors

Add adapters without modifying core runtime.

### More Pipelines

Possible future presets:

```text
bugfix
refactor
security-audit
migration
performance
review-only
incident-fix
```

### Git Isolation

Worktrees and isolated agent workspaces.

### Replay

Replay a run from a selected artifact or stage.

---

## 33. Product Principles

Volibear should preserve these principles throughout development.

### 1. Agents think. Volibear orchestrates.

Pipeline control belongs to deterministic runtime code.

### 2. Discovery before autonomy.

Architecture cannot begin until important human decisions are resolved.

### 3. Agents communicate through artifacts.

Do not rely on a giant shared conversation.

### 4. Gates decide progression.

Models produce evidence. Runtime gates decide whether work advances.

### 5. Executor, router, model, and agent are independent.

Users may mix them freely.

### 6. Portable by design.

Volibear must not belong to OpenCode, Codex, Claude, or 9Router.

### 7. Simple outside, strict inside.

The user experience should remain:

```bash
npx volibear install
npx volibear build "..."
```

even when the runtime underneath is sophisticated.

### 8. No silent assumptions on blocking decisions.

Rubberduck must remain strict.

### 9. No infinite loops.

Every repair loop has a configured maximum.

### 10. Reproducibility over magic.

Important configuration and artifacts should be inspectable and versionable.

---

## 34. MVP Definition in One Sentence

> Volibear MVP is a portable runtime that takes a software task or review findings, forces a strict interactive discovery with the user, locks the requirements, then coordinates configurable AI engineering agents across multiple coding CLIs, routers, and models until the change is implemented, reviewed, repaired, and deterministically verified.
