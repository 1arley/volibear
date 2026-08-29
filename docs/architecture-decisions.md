# Volibear Architecture Decisions

## AD-001: Core owns progression

Pipeline progression, repair limits, blocking-question checks, requirements locking, and terminal run states are decided by runtime code. Agents and executors produce evidence and artifacts; they do not decide whether the pipeline advances.

## AD-002: Agent, executor, router, and model are independent

An agent definition describes a role and its permissions. Project configuration independently selects the executor, router, and model for each role. Pipeline stages reference agents, never executor-specific commands.

## AD-003: Artifacts are the stage boundary

Stages exchange structured files in the run directory. Transcripts are not implicit inputs to later stages. This keeps review independent from implementation reasoning and makes runs inspectable and resumable.

## AD-004: Rubberduck has two separate interfaces

Rubberduck consists of:

- a `RubberduckDriver`, which discovers questions, proposes delegated defaults, and generates a requirements draft;
- a `RubberduckInteraction`, which collects explicit human answers, delegation approval, and lock approval.

The deterministic `RubberduckSession` state machine owns question tracking and the transition to `LOCKED`. This prevents a model or CLI adapter from silently resolving blocking decisions.

## AD-005: Non-interactive discovery is safe by default

When stdin is not interactive, `build` and `fix` persist discovery and end in `WAITING_FOR_USER`. Automatic delegated defaults require the explicit `--accept-defaults` flag. A run in `WAITING_FOR_USER` is resumable and is not reported as `FAIL` or `BLOCKED`.

## AD-006: Architect lock is a Core invariant

Before invoking any stage whose agent is `architect`, the runtime checks for both `requirements.json` and `requirements.lock`. This check applies even to custom pipelines that omit a declarative lock gate.

## AD-007: Local files are the persistence layer

Each run owns `run.json`, `events.jsonl`, and its artifacts beneath `.volibear/.runs/<run-id>/`. JSON snapshots support interruption and resume without a database. Event logs remain append-only.
