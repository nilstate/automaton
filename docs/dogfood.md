# Dogfood

Aster's dogfood campaign. Every cycle runs a runx composite skill via the
`runx` CLI on a real objective, diagnoses the receipt, and lands a bounded
improvement to the skill or its specs. The dogfood IS the improvement
cycle: each pass through the loop must leave the catalog measurably better
and must produce at least one committed change to a skill, spec, or
harness fixture. A cycle that produces no improvement is a no-op and is
re-run.

## Cycle shape

```
1. pick objective + target skill
2. runx <target-skill> ...           → produces receipt rx_*
3. runx receipt-review --receipt rx_*  → produces diagnosis (verdict + proposals)
4. runx harness-author --diagnosis ...  → produces skill edit + fixture patch
5. apply the patch, bump the skill version, re-run the harness
6. land the change + record the cycle in the catalog below
```

Step 3+4 together are the `improve-skill` composite. A cycle can call
`runx improve-skill --receipt rx_*` to run them as one step, or split
them when iterating on receipt-review or harness-author themselves.

## Skill catalog

Source of truth: [runx/oss/skills/](../../runx/oss/skills/). Skills
listed here rotate through cycles. "Last cycle" records the cycle id
(the scafld task id) that most recently dogfooded the skill.

| Skill | Status | Last cycle | Version after last cycle | Notes |
| --- | --- | --- | --- | --- |
| improve-skill | dogfooded | dogfood-cycle-1-improve-skill | oss@6f0bfa6 + harness expanded to 2 cases | Calibrated in cycle 1: added `improve-skill-passes-on-paused-chain` harness case. |
| receipt-review | dogfooded | dogfood-cycle-2-receipt-review | oss working tree + SKILL.md pause paragraph + 2 harness cases | Cycle 2 closed the pause-vs-failure gap at the component level. |
| harness-author | dogfooded | dogfood-cycle-3-harness-author | oss working tree + SKILL.md pass-verdict paragraph + 3 harness cases | Cycle 3 specified behaviour on pass-verdict review input. |
| skill-recon | dogfooded | dogfood-cycle-4-skill-recon | oss working tree + SKILL.md reuse paragraph + 2 harness cases | Cycle 4 elevated 'recommend reuse' as first-class output. |
| evaluate-skill | dogfooded | dogfood-round-2-coverage-pass | oss + needs-skill-ref negative case | Round 2 added negative-case fixture. |
| objective-decompose | surveyed (cycle 6) | — | 2 harness cases | Cycle 6 audit only. |
| objective-to-skill | dogfooded | dogfood-round-2-coverage-pass | oss + needs-objective negative case | Round 2 added negative-case fixture. |
| evolve | surveyed (cycle 6) | — | 2 harness cases | Cycle 6 audit only. |
| research | dogfooded | dogfood-round-2-coverage-pass | oss + needs-objective negative case | Round 2 added negative-case fixture. |
| market-intelligence | dogfooded | dogfood-round-2-coverage-pass | oss + minimal-inputs boundary case | Round 2 added boundary fixture. |
| content-pipeline | dogfooded | dogfood-round-2-coverage-pass | oss + needs-objective negative case | Round 2 added negative-case fixture. |
| draft-content | surveyed (cycle 6) | — | 2 harness cases | Cycle 6 audit only. |
| bug-to-pr | removed | — | — | Empty directory; not implemented. Removed from catalog. |
| issue-to-pr | dogfooded | dogfood-cycle-9-issue-to-pr-full-chain | issue-to-pr 0.1.2 + three harness cases including full-chain success | Cycle 9 exercises every agent-step hand-off through scafld-complete. |
| github-triage | surveyed (cycle 6) | — | 2 harness cases | Cycle 6 audit only. |
| open-source-triage | dogfooded | dogfood-round-2-coverage-pass | oss + minimal-inputs boundary case | Round 2 added boundary fixture. |
| ecosystem-vuln-scan | dogfooded | dogfood-round-2-coverage-pass | oss + needs-target negative case | Round 2 added negative-case fixture. |
| moltbook | surveyed (cycle 6) | — | 2 harness cases | Cycle 6 audit only. |
| moltbook-presence | dogfooded | dogfood-round-2-coverage-pass | oss + minimal-inputs boundary case | Round 2 added boundary fixture. |
| scafld | dogfooded | dogfood-round-2-coverage-pass | oss + agent-needs-required-inputs case | Round 2 added boundary fixture. |

Every skill here graduates to `dogfooded` once it has at least one cycle
with a merged improvement and a passing harness. Subsequent cycles
re-dogfood as the skill catalog grows.

## Ordering

Cycle 1: **improve-skill** itself. Calibrate the dogfood instrument
before we use it on everyone else. If improve-skill is broken, every
downstream cycle is compromised.

Cycle 2–3: **receipt-review**, **harness-author**. The two halves of
improve-skill; once we've dogfooded the composite, drill into the
components.

Cycle 4+: pick by receipt availability first (skills with seed receipts
under `.artifacts/runx-dogfood/` go before skills that need a fresh
objective), then by coverage gaps.

## Per-cycle evidence layout

Each cycle writes to `.artifacts/dogfood-cycles/<cycle-id>/`:

```
.artifacts/dogfood-cycles/
  <cycle-id>/
    objective.md              # one-paragraph real objective and success criterion
    receipt.json              # the runx <target-skill> receipt
    diagnosis.json            # receipt-review output
    improvement.md            # harness-author output + rationale
    patch.diff                # the landed change to the skill or spec
    cycle_metadata.json       # summary: skill, receipt_id, verdict, version_before, version_after
```

`cycle_metadata.json` schema:

```json
{
  "cycle_id": "dogfood-cycle-1-improve-skill",
  "target_skill": "improve-skill",
  "target_skill_path": "runx/oss/skills/improve-skill",
  "objective": "One-paragraph objective text",
  "runx_run_id": "rx_...",
  "receipt_path": ".artifacts/dogfood-cycles/.../receipt.json",
  "verdict": "needs_update | pass | fail",
  "improvement_summary": "One sentence on what was changed",
  "version_before": "0.x.y",
  "version_after": "0.x.y+1",
  "spec_links": [],
  "started_at": "",
  "completed_at": "",
  "receipt_pressure_signals": {
    "receipt_bytes": 0,
    "journal_entries": 0,
    "chain_steps": 0,
    "search_candidates": 0
  }
}
```

The `receipt_pressure_signals` block is the primary evidence stream
for the governed-receipts vs hosted-memory decision: every cycle adds
one row with bytes/entries/steps/search counts, and the running total
tells us when either platform surface becomes justified.

## Cycle log

Populated per cycle as each one completes.

| Cycle id | Skill | Verdict | Version bump | Improvement | Receipt bytes | Evidence path |
| --- | --- | --- | --- | --- | --- | --- |
| dogfood-cycle-1-improve-skill | improve-skill | needs_update | oss working tree (no skill-level version field yet) | Added paused-chain pass-case to improve-skill harness | 3274 | [.artifacts/dogfood-cycles/dogfood-cycle-1-improve-skill/](../.artifacts/dogfood-cycles/dogfood-cycle-1-improve-skill/) |
| dogfood-cycle-2-receipt-review | receipt-review | needs_update | oss working tree; SKILL.md expanded + harness at 2 cases | Added agent-mediated-suspension paragraph and pass-on-paused harness case | 1820 | [.artifacts/dogfood-cycles/dogfood-cycle-2-receipt-review/](../.artifacts/dogfood-cycles/dogfood-cycle-2-receipt-review/) |
| dogfood-cycle-3-harness-author | harness-author | needs_update | oss working tree; SKILL.md expanded + harness at 3 cases | Added pass-verdict paragraph and harness-author-honors-pass-verdict case; surfaced `runx resume` local-path defect as follow-up | 896 | [.artifacts/dogfood-cycles/dogfood-cycle-3-harness-author/](../.artifacts/dogfood-cycles/dogfood-cycle-3-harness-author/) |
| dogfood-cycle-4-skill-recon | skill-recon | needs_update | oss working tree; SKILL.md expanded + harness at 2 cases | Elevated 'recommend reuse' as first-class output; added skill-recon-recommends-reuse harness case | 716 | [.artifacts/dogfood-cycles/dogfood-cycle-4-skill-recon/](../.artifacts/dogfood-cycles/dogfood-cycle-4-skill-recon/) |
| dogfood-cycle-5-issue-to-pr | issue-to-pr | needs_update | oss working tree; first harness case added | Filled the zero-case harness gap with a smoke-test fixture | 214 | [.artifacts/dogfood-cycles/dogfood-cycle-5-issue-to-pr/](../.artifacts/dogfood-cycles/dogfood-cycle-5-issue-to-pr/) |
| dogfood-cycle-6-catalog-sweep | (catalog) | audit | docs/dogfood.md | Round-1 close: surveyed 14 skills, identified systemic 1-case pattern, queued round 2 | 0 | [.artifacts/dogfood-cycles/dogfood-cycle-6-catalog-sweep/](../.artifacts/dogfood-cycles/dogfood-cycle-6-catalog-sweep/) |
| fix-scafld-new-in-harness | scafld+issue-to-pr | pass_with_issues | scafld 1.4.0 → 1.4.1 (auto-init in bare cwd); issue-to-pr chain prelude | Fix for harness-isolation gap surfaced in cycle 5; follow-up: wire task_id into scafld-* step inputs | 0 | — |
| runx-skill-version-convention | all skills | pass | 22 X.yaml files + VERSIONING.md | Added version field convention (0.1.0 baseline) across all runx skills | 0 | — |
| dogfood-cycle-7-issue-to-pr-deep | issue-to-pr | no_improvement_found | — | Bounded harness extension blocked by task_id propagation defect; follow-up recorded | 0 | [.artifacts/dogfood-cycles/dogfood-cycle-7-issue-to-pr-deep/](../.artifacts/dogfood-cycles/dogfood-cycle-7-issue-to-pr-deep/) |
| dogfood-round-2-coverage-pass | 9 skills | pass | +1 harness case per skill | Round 2 coverage: 9 single-case skills now carry a negative/boundary fixture | 0 | — |
| dogfood-cycle-8-issue-to-pr-author-spec | issue-to-pr | needs_update | issue-to-pr 0.1.0 → 0.1.1 + deeper harness case | Added issue-to-pr-reaches-author-spec (canned caller.answers) and retracted the cycle-7 misdiagnosis | 420 | [.artifacts/dogfood-cycles/dogfood-cycle-8-issue-to-pr-author-spec/](../.artifacts/dogfood-cycles/dogfood-cycle-8-issue-to-pr-author-spec/) |
| harness-cli-tool-sandbox-fix | runx harness + scafld | (infra) | packages/harness/src/runner.ts + skills/scafld/run.mjs | Harness now sandboxes cli-tool cwd to tempdir; scafld honors RUNX_CWD. Unlocks full-chain harness cases. | 0 | — |
| dogfood-cycle-9-issue-to-pr-full-chain | issue-to-pr | needs_update | issue-to-pr 0.1.1 → 0.1.2; +full-chain harness case | First full-chain harness case: chain executes all 15 steps through scafld-complete with status success | 480 | [.artifacts/dogfood-cycles/dogfood-cycle-9-issue-to-pr-full-chain/](../.artifacts/dogfood-cycles/dogfood-cycle-9-issue-to-pr-full-chain/) |
| dogfood-cycle-10-sweep-final | skill-testing + sourcey | needs_update | +1 harness case per skill | Closes round-2 coverage floor: every catalog X.yaml has ≥2 passing cases | 0 | [.artifacts/dogfood-cycles/dogfood-cycle-10-sweep-final/](../.artifacts/dogfood-cycles/dogfood-cycle-10-sweep-final/) |

## Platform pressure signals

Aggregated from `cycle_metadata.json.receipt_pressure_signals` across
all completed cycles. Rebuilt on demand; this table is the ground
truth for the platform-next-move decision.

| Signal | Current value | Threshold for governed receipts | Threshold for hosted memory |
| --- | --- | --- | --- |
| Total receipts | 6 | receipt search/replay would materially reduce review time | — |
| Total receipt bytes | 7340 | — | local store starts hitting IO or concurrency pressure |
| Distinct subject identities | 5 (improve-skill, receipt-review, harness-author, skill-recon, issue-to-pr) | — | cross-session context lookups become common |
| Manual receipt scrolls / week | 0 | governed receipts search wins | — |

Latest end-to-end receipt: `rx_0df2fb9885bf4b67b4c8bc6f3d1204ad`
(improve-skill on a synthetic market-intelligence paused receipt),
landed under `~/dev/scafld/.runx/receipts/`. Receipt dir is
working-directory-relative — confirming the earlier cycle-6
pressure observation that cross-session context lookups do not
yet pay off, because runx users must `cd` to the same workdir to
find prior receipts.

The thresholds are intentionally qualitative and not pre-committed.
Each cycle adds evidence; the decision is taken when one column's
signal is unambiguous, not at a fixed cycle count.

## Catalog audit (cycle 6)

All 14 remaining skills were surveyed via `runx harness` at the
close of round 1. Every harness passes. The systemic pattern is
coverage thinness: 9 of 14 skills have only a single happy-path
case. The appropriate response is a dedicated round-2 coverage
pass rather than bespoke cycles per skill.

| Skill | Harness status | Cases |
| --- | --- | --- |
| evolve | success | 2 |
| objective-decompose | success | 2 |
| objective-to-skill | success | 1 |
| evaluate-skill | success | 1 |
| research | success | 1 |
| market-intelligence | success | 1 |
| content-pipeline | success | 1 |
| draft-content | success | 2 |
| github-triage | success | 2 |
| open-source-triage | success | 1 |
| ecosystem-vuln-scan | success | 1 |
| moltbook | success | 2 |
| moltbook-presence | success | 1 |
| scafld | success | 1 |

## Round 1 — close note

**Six cycles landed** over campaign round 1:

1. `dogfood-cycle-1-improve-skill` — added a paused-chain pass-case.
2. `dogfood-cycle-2-receipt-review` — SKILL.md pause-semantics + pass-case.
3. `dogfood-cycle-3-harness-author` — SKILL.md pass-verdict + pass-case.
4. `dogfood-cycle-4-skill-recon` — SKILL.md recommend-reuse + reuse case.
5. `dogfood-cycle-5-issue-to-pr` — filled a zero-case harness gap.
6. `dogfood-cycle-6-catalog-sweep` — surveyed 14 skills, queued round 2.

**Platform follow-ups discovered in round 1:**

- `runx resume` used to reject runs invoked via local path with
  "no pending skill path recorded". Fixed by the runner-local
  change committed as `fix(runner-local): write journal on
  missing-input needs_resolution`.
- `issue-to-pr`'s first step (`scafld-new`) cannot execute inside
  the runx harness sandbox because the sandbox cwd is not a
  scafld workspace. Logged in cycle 5 for follow-up.
- Runx skills have no versioning convention. Logged in cycle 1
  follow-ups; the campaign falls back to the `oss/` submodule
  git sha as the version signal.

**Platform next-move call:** governed receipts and hosted memory
both remain deferred. Round 1 added 5 receipts and 5 subjects;
nowhere near the pressure required to justify either platform
surface. Round 2 (coverage pass) should produce more real
receipt traffic and sharpen the signal.

## Round 2 — close note

Round 2 ran through `dogfood-round-2-coverage-pass`,
`dogfood-cycle-7-issue-to-pr-deep` (failed → superseded),
`dogfood-cycle-8-issue-to-pr-author-spec`,
`dogfood-cycle-9-issue-to-pr-full-chain`, and
`dogfood-cycle-10-sweep-final`. Platform fixes also landed during
round 2: scafld 1.4.1 auto-init, skill version convention, and
the harness cli-tool cwd sandbox.

Coverage invariant at round-2 close: **every catalog skill with
an X.yaml has ≥ 2 passing harness cases**. Enforced per spec by
the cycle-10 v2 acceptance check, which walks every
`oss/skills/*/X.yaml` and runs `runx harness`.

issue-to-pr is the first composite skill with a full-chain
harness case that executes all 15 governed steps through
scafld-complete. Its fixture pattern (canned caller.answers per
agent-step hand-off) is the template other composite chains can
adopt when they need equivalent depth.

Round 3 scope (queued, not started): convert one more composite
chain to a full-chain harness (content-pipeline is the obvious
next candidate — it already has 4 steps and a happy-path
fixture; extending it to full-chain would follow the cycle-9
pattern). Before round 3, the priority is running real `runx
<skill>` invocations to pump the pressure-signal numbers and
inform the governed-receipts-vs-hosted-memory decision.
