---
title: Aster LLM Training Spec
updated: 2026-04-17
visibility: internal
---

# Aster LLM Training Spec

This document defines the current prerelease `v1` learned-layer contract for
`aster`.

It is not doctrine. It is the exact operator-state and selector contract that
an LLM or training pipeline should learn against.

## Scope

- target universe: `nilstate/*` only
- mutation posture: draft-first, human-reviewed
- destructive actions: never inferred from model output
- external public portfolio: out of scope for prerelease `v1`

## Canonical objects

Canonical machine-readable control state lives in:

- `state/aster-control.json`
- `state/thread-teaching.json`
- `spec/aster-control.schema.json`
- `spec/selector-training-row.schema.json`
- `spec/thread-teaching-row.schema.json`

These schemas are repo-local on purpose. They are not part of the public
`runx` protocol surface.

The minimum durable objects are:

- `Target`
- `Opportunity`
- `Priority`
- `ReflectionEntry`
- `CycleRecord`

`receipts`, `verification-report.json`, `grant` objects, and thread-teaching
records remain the higher-trust evidence layer. `aster-control.json` is a
learned projection over that evidence, not a replacement for it.

## Opportunity labels

Every candidate opportunity is labeled with:

- `budget_bucket`
- `authority_cost`
- `evidence_at`
- `thesis_score`
- `authority`

Current bucket mapping:

- `issue-triage` -> `thesis_work`
- `skill-lab` -> `context_improvement`
- `proving-ground` -> `runtime_proof_work`

Current authority-cost rubric:

- `proving-ground` -> `0.08`
- `skill-lab` -> `0.28`
- public issue reply lane -> `0.48`
- public PR reply lane -> `0.56`
- other bounded internal work -> `0.32`

Lower authority cost wins ties.

## Thesis score contract

Positive factors stay normalized to `0.0-1.0`:

- `stranger_value`
- `proof_strength`
- `compounding_value`
- `tractability`
- `novelty`
- `maintenance_efficiency`

Current weighted score remains:

- `stranger_value` -> `0.24`
- `proof_strength` -> `0.24`
- `compounding_value` -> `0.19`
- `tractability` -> `0.16`
- `novelty` -> `0.09`
- `maintenance_efficiency` -> `0.08`

Hard vetoes still apply before selection:

- target outside prerelease scope
- lane not allowed by dossier
- generated derived-state PR conflict
- trust-recovery cooldown
- public-comment policy veto
- score floors:
  - `stranger_value < 0.60`
  - `proof_strength < 0.70`

## Selector contract

The selector now runs in this order:

1. discover candidates
2. score candidates
3. drop vetoed entries
4. drop entries below `minimum_select_score`
5. enforce portfolio budget
6. apply the exact tie-break order
7. persist `Priority` and `CycleRecord`
8. dispatch only after persistence

Current `minimum_select_score` is `0.68`.

### Exact tie-break order

For candidates that survive budget filtering:

1. higher `score`
2. higher `proof_strength`
3. lower `authority_cost`
4. higher `tractability`
5. newer `evidence_at`

### Portfolio budget

Current portfolio mix:

- `thesis_work` -> `0.70`
- `context_improvement` -> `0.20`
- `runtime_proof_work` -> `0.10`

Current rolling window:

- `10` cycles

Implementation rule:

- read the most recent `window_cycles - 1` non-no-op `CycleRecord.selected_bucket`
- project one additional cycle for each candidate bucket
- compute projected portfolio error as the sum of absolute share deltas from
  the target mix
- keep only candidates with the minimum projected error
- apply the tie-break order over that reduced set

This makes budget selection deterministic and training-compatible.

## Durable outputs

Every cycle writes:

- one or more `Priority` objects with per-cycle `priority_id`
- one `CycleRecord`
- updated `Target.lifecycle` state for every evaluated repo

`Priority.priority_id` is cycle-scoped. It is not reused across cycles.

`Priority` must also persist the normalized `authority` object used to bound
the work.

`CycleRecord` stores:

- `priority_ids`
- `selected_priority_id`
- `selected_bucket`
- `budget_snapshot`
- `authority`
- `dispatch`
- `reason`
- `status`

If the selector chooses no action, it still writes a `CycleRecord` with
`status = no_op`.

`Target.lifecycle` stores:

- `last_evaluated_at`
- `last_selected_at`
- `last_dispatched_at`
- `last_cycle_id`
- `last_cycle_status`
- `last_transition_reason`
- `evaluated_count`
- `selected_count`
- `dispatched_count`

## Selector training row

The canonical labeled export for one selector decision is:

- `spec/selector-training-row.schema.json`

The row is a projection over one concrete `aster-cycle` result. It keeps:

- the full scored candidate set
- the exact `priority_queue`
- the final selected priority and opportunity ids
- the budget snapshot that constrained the choice
- the dispatch decision after persistence

The row is intentionally label-first. It is not a replacement for
`aster-control.json`; it is the one-example training artifact derived from a
cycle run.

Current emitter:

```bash
node scripts/aster-cycle.mjs --training-output .artifacts/aster/selector-training-row.json
```

## Issue teaching row

The canonical labeled export for one thread-teaching record is:

- `spec/thread-teaching-row.schema.json`

The rows live inside `state/thread-teaching.json` under `teaching_rows`.

They are derived from trusted issue and PR thread records and are intended to
teach:

- gate authorization decisions
- target-specific norms
- reusable maintainer lessons
- corrections to earlier human guidance

## Public-surface contract

The public priorities page must read from `state/aster-control.json`, not only
from prose markdown. Markdown remains the human-facing narrative layer.

Public pages should treat these fields as authoritative for current operator
state:

- latest cycle status
- latest cycle reason
- controlling priority queue
- selected budget bucket
- authority scope and approval mode
- dispatch status and target repo
- selected target lifecycle counters

## Training target semantics

For supervised or synthetic training:

- a good label is one that reproduces the selected `Priority` and the written
  `CycleRecord`
- a bad label is one that would:
  - widen scope beyond `nilstate/*`
  - ignore a veto
  - bypass the budget filter
  - violate tie-break order
  - mutate before persistence
  - replace a justified `no_op` with public theater

The target behavior is not “maximize action”. The target behavior is “maximize
proof while preserving scope, budget, and credibility”.

## Runtime lineage coupling

Selector labels are only half of the LLM training story. Runtime examples
remain grounded in the public `runx` receipt export schema:

- `https://runx.ai/spec/training/trainable-receipt-row.schema.json`

`aster` labels teach the selector what to choose. `runx` trainable receipt rows
teach downstream models what a governed runtime execution and later outcome
look like.
