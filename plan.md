---
title: Native OpenCode Volibear Pipeline
status: ready-for-execution
scope: 1arley/volibear
---

# Plan: Move Volibear's OpenCode integration to native in-session subagents

## Objective

Change the OpenCode integration so that `volibear` is a native OpenCode primary
agent/orchestrator that delegates:

`rubberduck → architect → developer → reviewer → fixer → reviewer → verifier`

through OpenCode's native `task`/subagent mechanism in the same OpenCode session.

The user must be able to see the active stage and subagent progress in the
OpenCode TUI instead of Volibear spawning independent/background OpenCode
sessions and only exposing Volibear's terminal output.

This change must preserve Volibear's deterministic pipeline semantics,
artifact-based stage boundaries, repair loop, permissions, resume behavior,
and verification authority.

Do not redesign the pipeline semantics. Change the OpenCode transport and
session topology.

---

# 1. Repository findings

The current repository already contains most of the required concepts.

## 1.1 Current OpenCode topology

`packages/executors/src/opencode.ts` currently creates a new OpenCode session for
every `runAgent()` invocation.

The important current behavior is:

- resolves an OpenCode server through `OpenCodeServerManager`;
- checks for `volibear-${agent}`;
- creates a fresh session;
- explicitly expects the created session to have no `parentID`;
- invokes `session.promptAsync()` with `agent: volibear-${agent}`;
- subscribes to OpenCode events;
- streams `message.part.updated`;
- handles permissions;
- waits for `session.status=idle` / `session.idle`;
- reads the latest assistant message;
- persists session metadata;
- supports recovery through `resumeSessionId`.

This is explicitly documented in the implementation as one fresh,
parentless session per call.

Relevant files:

- `packages/executors/src/opencode.ts`
- `packages/executors/src/opencode-client.ts`
- `packages/executors/src/opencode.test.ts`

## 1.2 Native OpenCode role agents already exist

The installer already treats OpenCode specially and generates:

- `.opencode/agents/volibear.md`
- `.opencode/agents/volibear-rubberduck.md`
- `.opencode/agents/volibear-architect.md`
- `.opencode/agents/volibear-developer.md`
- `.opencode/agents/volibear-reviewer.md`
- `.opencode/agents/volibear-fixer.md`
- `.opencode/agents/volibear-verifier.md`

`packages/cli/src/install/templates.ts` renders these as:

- `mode: subagent`
- role-specific permissions
- `task: deny`

The role-agent architecture therefore already matches the desired OpenCode
subagent model.

The main missing piece is the top-level `volibear` agent: it is currently only
a bridge that invokes the external Volibear CLI.

## 1.3 Current bridge is the wrong topology for OpenCode

`packages/cli/resources/install/opencode.md` currently says, in effect:

- the agent is a bridge;
- it must not perform pipeline work;
- it invokes `volibear build` / `volibear fix`;
- it handles Volibear's pending questions;
- it reports the resulting PASS/FAIL/BLOCKED status.

That means the actual pipeline lives outside the OpenCode session.

The proposed change must replace this bridge behavior with native orchestration.

## 1.4 Artifacts are already the intended stage boundary

The repository architecture explicitly defines artifacts as the boundary between
stages rather than conversation transcripts.

The run contains persisted artifacts such as:

- `requirements.json`
- `requirements.lock`
- `architecture.md`
- `architecture.json`
- `implementation.json`
- `review.json`
- `verification.json`

`packages/runtime/src/handoffs.ts` already constructs a role-specific
`StageHandoff` by reading the ArtifactStore.

Current handoff inputs are:

| Agent | Current handoff inputs |
|---|---|
| Rubberduck | findings, discovery |
| Architect | requirements, requirements.lock |
| Developer | requirements, architecture |
| Reviewer | architecture, implementation |
| Fixer | architecture, implementation, review |
| Verifier | verification, verification commands |

This is the correct conceptual model to preserve.

## 1.5 Runtime already persists execution/session state

`packages/runtime/src/stage-runner.ts`:

- builds the stage handoff;
- persists execution records;
- invokes `executor.runAgent()`;
- persists raw/structured output;
- persists agent artifacts;
- updates execution state;
- handles repair cycles;
- enforces permissions;
- records events.

`ExecutorContext` already contains:

- `handoff`
- `pipelineContext`
- `executionId`
- `resumeSessionId`
- streaming callbacks
- metadata callbacks.

Therefore the artifact model does not need to be replaced merely because
OpenCode becomes native.

---

# 2. Target architecture

## 2.1 OpenCode path

For OpenCode, the topology becomes:

```text
OpenCode user session
        |
        v
   volibear (primary)
        |
        +--> task(rubberduck)
        |
        +--> task(architect)
        |
        +--> task(developer)
        |
        +--> task(reviewer)
        |
        +--> task(fixer)       [only if required]
        |
        +--> task(reviewer)    [re-review]
        |
        +--> task(verifier)
        |
        v
      result
```

Every delegated stage is a native child/subagent execution of the same
OpenCode session.

The OpenCode TUI should therefore expose the delegation hierarchy and the
agent currently executing.

## 2.2 Artifact topology

Do NOT use the parent conversation transcript as the authoritative handoff.

The source of truth remains:

```text
.volibear/.runs/<run-id>/
```

The flow is:

```text
previous agent
      |
      v
structured output
      |
      v
Volibear artifact persistence
      |
      v
buildStageHandoff()
      |
      v
next native OpenCode subagent
```

The next agent receives only the stage-specific handoff plus the repository
context it needs.

The shared OpenCode conversation is for visibility/orchestration, not for
artifact correctness.

---

# 3. Required implementation strategy

## Phase 1 — Separate OpenCode-native orchestration from CLI executors

Do not delete the existing executor abstraction.

OpenCode, Claude and Codex must remain supported.

The native OpenCode mode should be an OpenCode integration path rather than
forcing Claude/Codex into OpenCode semantics.

Preserve:

```text
Executor
 ├── mock
 ├── opencode
 ├── codex
 └── claude
```

The current headless OpenCode executor should remain available for:

- direct runtime execution;
- automation;
- CI;
- non-native contexts;
- resume/recovery;
- tests that explicitly exercise executor transport.

The new native session flow should be added as the OpenCode integration mode.

Do not make the current `OpenCodeExecutor` create parentless sessions when it
is explicitly operating in native-subagent mode.

---

# 4. Replace the OpenCode bridge agent

Update the bundled OpenCode `volibear.md`.

It must become a primary orchestrator, not a CLI bridge.

Use this as the baseline content:

```md
---
description: Execute the complete Volibear engineering pipeline.
mode: primary
---

You are Volibear, the engineering pipeline orchestrator.

Your responsibility is to coordinate the complete software engineering
lifecycle for the user's task.

You do not implement the task yourself.

You MUST delegate specialized work to the appropriate Volibear subagent.

## Pipeline

1. rubberduck
2. architect
3. developer
4. reviewer
5. fixer — only when reviewer reports actionable findings
6. reviewer — re-review after fixes
7. verifier

## Available subagents

- rubberduck — requirements discovery and ambiguity analysis
- architect — architecture and acceptance criteria
- developer — implementation
- reviewer — code review and findings
- fixer — repair of review findings
- verifier — deterministic verification

## Delegation rules

Use OpenCode's native task/subagent mechanism.

Every specialized stage must run as a native subagent of this session.

Do not invoke the Volibear CLI to execute the stage.

Do not create independent/background coding-CLI sessions.

Do not perform specialized stage work yourself.

The user must be able to see the delegated agent and its progress in the
OpenCode session.

## Pipeline rules

- Never implement before requirements are sufficiently understood.
- Never skip architecture.
- Never consider implementation complete before review.
- If review has actionable findings, delegate to fixer.
- After fixer, always delegate reviewer again.
- Stop the repair loop only when no findings remain at or above the configured
  threshold.
- Finish only after verifier succeeds.
- Never silently answer a blocking product decision.
- Ask the user when Rubberduck reports a blocking question.
- Preserve stage artifacts and findings between stages.

## Artifact rules

Artifacts are the authoritative stage boundary.

Do not use conversation history as a substitute for stage artifacts.

Before delegating a stage, use the current Volibear run state and stage
handoff as the source of truth for that stage's inputs.

After a subagent returns, ensure its structured result is persisted into the
corresponding Volibear artifact before the next stage begins.

Expected artifacts:

- requirements.json
- requirements.lock
- architecture.md
- architecture.json
- acceptance.json
- implementation.json
- review.json
- verification.json

## Completion

Only report completion when:

1. requirements are resolved and locked;
2. architecture is complete;
3. implementation is complete;
4. review has no findings above the configured threshold;
5. deterministic verification succeeds.

Report:

- completed stages;
- implementation summary;
- review status;
- verification status;
- unresolved findings, if any.
```

The exact wording may be refined by the implementation agent, but these
behavioral requirements are mandatory.

---

# 5. Define the native orchestration contract

The implementation must establish a clear contract between the primary
`volibear` agent and each native role agent.

Each role invocation needs:

```text
run id
pipeline
stage id
role
cycle
attempt
task
stage-specific artifact inputs
expected output schema
constraints
```

This is already represented by `StageHandoff`.

Do not invent a second incompatible handoff format.

Reuse or adapt the existing `StageHandoff` contract.

The primary orchestrator must be able to identify which run and stage a native
subagent belongs to.

---

# 6. Artifact persistence problem

This is the most important architectural detail.

A native OpenCode subagent returns its response to the parent OpenCode agent,
but the Volibear runtime currently persists structured results inside
`runAgentStage()`.

Therefore the implementation must introduce an explicit persistence boundary
for native delegation.

Required sequence:

```text
1. Build stage handoff
2. Delegate native subagent
3. Receive structured response
4. Validate response against the role schema
5. Persist raw execution output
6. Persist structured execution output
7. Persist role artifact
8. Update stage execution status
9. Evaluate deterministic gate
10. Delegate next stage
```

Never delegate the next stage before step 7 succeeds.

If persistence or schema validation fails, the pipeline must stop rather than
silently passing an unpersisted conversational response downstream.

---

# 7. Rubberduck special case

Rubberduck is interactive.

Its native subagent must be able to ask the user blocking questions through
OpenCode's native interaction mechanism.

The primary Volibear agent must not fabricate answers.

Required behavior:

```text
Rubberduck
    |
    +--> no blocking questions --> requirements locked --> Architect
    |
    +--> blocking question
             |
             v
        OpenCode user interaction
             |
             v
        Rubberduck resumes
```

The existing Volibear `WAITING_FOR_USER` semantics must remain represented in
the persisted run state.

Do not implement a second independent question state machine inside the
OpenCode bridge.

---

# 8. Repair loop

The native implementation must preserve the current deterministic loop.

Expected behavior:

```text
Developer
   |
Reviewer
   |
   +-- no high/critical findings --> Verification
   |
   +-- findings --> Fixer
                     |
                     v
                   Reviewer
                     |
                     +--> repeat until gate passes
```

The existing `max_cycles` and `reject_on` configuration remain authoritative.

The primary agent must not decide that a review is clean based solely on
natural-language interpretation if `review.json` and the deterministic gate
say otherwise.

---

# 9. Permissions

Preserve the current role permission model.

Expected role policy:

| Role | Repository | Shell | Task |
|---|---|---|---|
| rubberduck | read | deny | deny |
| architect | read | deny | deny |
| developer | write | allow | deny |
| reviewer | read | deny | deny |
| fixer | write | allow | deny |
| verifier | read | allow | deny |

The `task: deny` constraint is important.

A role agent must not recursively invoke another Volibear agent and create an
uncontrolled orchestration tree.

Only the primary `volibear` agent may delegate pipeline stages.

---

# 10. Session identity

Native OpenCode delegation must preserve parent/child session relationships.

Do not use the current invariant:

```text
parentID must be absent
```

for native-subagent mode.

Instead:

- the top-level Volibear session is the root;
- every role invocation is a child task/session managed by OpenCode;
- the child must be associated with the current parent session;
- execution metadata must persist the native session/task identifier where the
  OpenCode SDK exposes it.

Do not assume the SDK's exact field names without checking the installed
OpenCode SDK version.

---

# 11. Progress visibility

The primary acceptance criterion is user-visible progress in OpenCode.

The implementation must not merely execute native agents while hiding their
output.

The TUI must visibly identify at least:

```text
Volibear
  rubberduck
  architect
  developer
  reviewer
  fixer
  reviewer
  verifier
```

The exact rendering is owned by OpenCode.

Volibear's responsibility is to use the native task/subagent API correctly and
not bypass it with detached sessions.

Do not attempt to build a second progress UI inside Volibear unless OpenCode
cannot expose task progress through its supported API.

---

# 12. Non-OpenCode compatibility

Do not break:

- `volibear build`
- `volibear fix`
- `volibear resume`
- `volibear status`
- mock executor
- Codex executor
- Claude executor
- deterministic verification
- artifact persistence
- event log
- repair loop.

The native OpenCode path is an additional execution topology.

Existing headless executor behavior should remain available unless a concrete
test proves that the old behavior is obsolete.

---

# 13. Resume and failure semantics

Native session failures must map to Volibear execution state.

At minimum handle:

- child task failure;
- child task cancellation;
- timeout;
- OpenCode connection failure;
- malformed structured output;
- missing artifact persistence;
- user cancellation;
- interrupted parent session.

Never retry a mutating developer/fixer task automatically if its side effects
are ambiguous.

This follows the existing `SESSION_LOST` /
`ambiguousSideEffects` behavior in the OpenCode executor.

For read-only roles, recovery may safely re-read the existing native session
where supported.

---

# 14. Tests required

## Unit tests

Add/update tests covering:

1. `volibear.md` is rendered as `mode: primary`.
2. The OpenCode bridge no longer invokes `volibear build` for normal execution.
3. The primary agent delegates using native task/subagent semantics.
4. Each role resolves to the correct `volibear-*` subagent.
5. `task: deny` remains on specialized role agents.
6. Stage handoffs contain only the expected artifact inputs.
7. Structured output is schema validated before artifact persistence.
8. Artifact persistence occurs before the next stage starts.
9. Rubberduck blocking questions pause the pipeline.
10. Reviewer findings cause fixer delegation.
11. Fixer is followed by reviewer.
12. Repair loop respects `max_cycles`.
13. Verification remains deterministic.
14. A failed verification prevents PASS.
15. Native child failure is surfaced to the parent.
16. Native developer/fixer session loss does not cause unsafe duplicate
    execution.
17. Non-OpenCode executors continue to work.

## Integration/smoke tests

Run a real OpenCode integration where the environment permits it.

Verify that:

- the `volibear` primary agent is visible;
- role agents appear as child/subagent work;
- the role order is correct;
- outputs are returned to the parent;
- artifacts are persisted;
- the repair loop is visible;
- verifier runs after deterministic verification;
- final result is reported in the same OpenCode session.

---

# 15. Files likely affected

The implementation agent must confirm exact paths before editing.

Expected areas:

```text
packages/cli/resources/install/opencode.md
packages/cli/src/install/templates.ts
packages/cli/src/install/plan.ts

packages/runtime/src/stage-runner.ts
packages/runtime/src/handoffs.ts

packages/contracts/src/executor.ts
packages/contracts/src/execution.ts

packages/executors/src/opencode.ts
packages/executors/src/opencode-client.ts

packages/executors/src/opencode.test.ts
packages/runtime/* tests
packages/cli/* install tests
```

Do not modify all listed files blindly. Inspect actual dependencies and make
the smallest coherent change.

---

# 16. Important architectural constraint

Do not duplicate the pipeline state machine.

There must remain one authoritative Volibear pipeline definition and one
authoritative artifact/gate model.

The OpenCode primary agent is the user-facing orchestration surface.

Volibear runtime remains responsible for deterministic state, artifacts,
gates, persistence and safety boundaries where possible.

The OpenCode subagents perform role work.

Avoid creating:

```text
OpenCode Volibear pipeline
+
Volibear runtime pipeline
```

as two independent sources of truth.

If native OpenCode orchestration requires a thin adapter, that adapter must
translate native task delegation into the existing Volibear pipeline state,
rather than implementing a second pipeline definition.

---

# 17. Acceptance criteria

## AC1 — Native primary agent

`.opencode/agents/volibear.md` is a primary OpenCode agent and no longer acts
as a simple CLI bridge.

## AC2 — Native subagents

Every specialized stage runs through OpenCode's native subagent/task mechanism.

## AC3 — Same-session visibility

The OpenCode TUI exposes the delegated stages and their progress as child work
of the active Volibear session.

## AC4 — No detached stage sessions

Normal native OpenCode execution does not create one independent parentless
OpenCode session per stage.

## AC5 — Artifact boundary

Stage-to-stage data is based on persisted Volibear artifacts and structured
handoffs, not conversation transcript assumptions.

## AC6 — Persistence before progression

A successful stage cannot advance until its structured output has been
validated and its artifact persisted.

## AC7 — Rubberduck interaction

Blocking Rubberduck questions are surfaced to the user through the active
OpenCode session and the pipeline waits for the answer.

## AC8 — Repair loop

Reviewer findings trigger fixer, followed by another reviewer, respecting
configured severity and cycle limits.

## AC9 — Deterministic verification

The verifier receives deterministic verification results, and the final PASS
authority remains the verification gate.

## AC10 — Permissions

Specialized agents cannot recursively delegate pipeline stages.

## AC11 — Resume safety

Interrupted mutating stages are not automatically replayed when side effects
are ambiguous.

## AC12 — Existing integrations

Claude, Codex, mock and direct Volibear CLI workflows remain functional.

## AC13 — Tests

All existing tests pass and new tests cover native OpenCode orchestration,
artifact handoff, repair loop and failure semantics.

---

# 18. Definition of done

The task is complete only when:

- the OpenCode integration is native;
- the user can visibly follow the Volibear pipeline in the OpenCode TUI;
- all six role agents are discoverable and correctly delegated;
- artifacts remain the authoritative handoff boundary;
- deterministic gates remain authoritative;
- repair/resume semantics remain safe;
- existing non-OpenCode integrations remain functional;
- automated tests pass;
- a real OpenCode smoke test demonstrates visible child-agent execution.

---

# 19. Implementation order

1. Inspect the installed OpenCode SDK version and its native task/subagent API.
2. Inspect current role-agent discovery and task semantics.
3. Define the native delegation adapter/contract without duplicating pipeline
   semantics.
4. Refactor the OpenCode integration so the primary agent is an orchestrator.
5. Connect native child results to existing `StageHandoff` and artifact
   persistence.
6. Preserve deterministic gates and repair-loop behavior.
7. Preserve permission and resume safety.
8. Update OpenCode installation templates and tests.
9. Update runtime/executor tests.
10. Run full test/build/lint/typecheck suite.
11. Run a real OpenCode smoke test.
12. Only then update documentation if behavior differs from current docs.

---

# 20. Explicit non-goals

Do not:

- redesign Volibear's pipeline;
- replace the ArtifactStore with conversation history;
- remove Claude/Codex support;
- create a new database;
- implement a custom TUI;
- allow role agents to recursively spawn arbitrary agents;
- make the model decide deterministic gates;
- automatically replay ambiguous mutating work;
- remove the existing headless OpenCode executor without evidence that it is
  no longer required.
