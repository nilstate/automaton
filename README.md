# aster

`aster` is the canonical public proving-ground destination for `runx`.

The repo itself now carries the operator core:

- constitutional doctrine under `doctrine/`
- mutable current state under `state/`
- append-only public memory under `history/` and `reflections/`
- the separate public face under `site/`
- working docs under `docs/` during migration

The docs in this repo are still about `aster` itself:

- what `aster` is trying to become
- the philosophy that governs how it should behave
- how it should evolve under governance
- which live lanes are real today
- what evidence each lane should emit

The `runx` engine docs still belong in the `runx` repo. `aster` is the
public target, not the place where the framework API and platform model should
be documented.

## Intention

`aster` is meant to become a repo that can improve itself gradually in
public.

The story is not "an autonomous agent that silently rewrites itself."

The story is:

1. `runx` inspects `aster`
2. `runx` proposes bounded changes and public updates
3. humans approve the next safe mutation
4. `aster` improves gradually, with receipts

That means the repo should accumulate a visible evolutionary trail:

- issues that get triaged instead of ignored
- bounded issues that become draft PRs
- PRs that receive operator-grade comments
- new skills that begin as proposals before they become automation
- docs that explain the current system honestly, including its gaps

The governing philosophy is:

- legibility over spectacle
- bounded action over vague autonomy
- receipts over claims
- governed evolution over hidden self-modification

## Live Lanes

`aster` now has seven concrete live lanes:

- `issue-triage`: covers both issue intake and PR review. Issues run through
  `support-triage`, can open `objective-decompose` when planning is approved,
  and only then start one or more repo-scoped `issue-to-pr` workers when build
  is approved. PR snapshots run through `github-triage`, pass replay/public
  gates, and publish one high-signal maintainer comment back onto the PR
- `fix-pr`: runs one bounded bugfix request through the governed PR runner,
  validates the target repo with its declared verification profile, and opens a
  draft `runx/*` PR
- `docs-pr`: runs one bounded docs or explanation request through the same
  governed PR runner, keeps the request docs-only, validates the result, and
  opens a draft `runx/*` PR
- `skill-lab`: a skill proposal issue runs through
  `objective-to-skill`, materializes a proposal in `docs/skill-proposals/`,
  and opens a draft PR
- `skill-upstream`: prepares and validates a portable upstream `SKILL.md`
  contribution packet and can open a draft PR against the target repo
- `merge-watch`: observes upstream contribution state and emits public proof
  when the status changes
- `proving-ground`: keeps a draft-first receipt trail for the broader catalog

Support workflows stay valuable even when the external caller is offline:

- `site-pages`: builds and deploys `aster.runx.ai` from repo-owned operator
  content
- `generated-pr-policy`: enforces draft-only plus human-review policy on
  generated `runx/*` PRs
- `rollback`: posts corrective comments or closes generated PRs when a public
  output needs to be superseded

## Required Secrets

`aster` needs only a small hosted secret surface:

- `OPENAI_API_KEY`: external caller for `runx` `agent-step` boundaries
- `RUNX_CALLER_MODEL` (optional): pinned model override for the hosted bridge
- `RUNX_REF` (repo variable): optional `runx` branch or tag for hosted
  checkouts; defaults to `main`
- `RUNX_REPOSITORY_PAT` (optional): GitHub token for private `runx` checkout
  and other cross-repo automation. The repo-scoped `github.token` is enough
  for same-repo workers; fanout into other repos needs broader access.

Without `OPENAI_API_KEY`, the mutation-capable lanes stay intentionally idle and
the draft-first observability lanes continue to run.

## Layout

- [docs/introduction.md](./docs/introduction.md): what `aster` is trying to
  prove
- [docs/philosophy.md](./docs/philosophy.md): the doctrine behind the repo's
  behavior and safety boundaries
- [docs/architecture.md](./docs/architecture.md): the full-shape plan,
  ownership boundary, memory model, and site topology
- [doctrine/ASTER.md](./doctrine/ASTER.md): the public thesis
- [doctrine/MISSION.md](./doctrine/MISSION.md): what kinds of actions most
  strongly prove the `runx` runtime thesis in public
- [doctrine/EXAMPLES.md](./doctrine/EXAMPLES.md): concrete good, bad, and
  `no_op` examples for public action
- [doctrine/CONDUCT.md](./doctrine/CONDUCT.md): how the operator should treat
  people and attention
- [doctrine/VOICE.md](./doctrine/VOICE.md): how public GitHub interaction
  should sound
- [doctrine/EPISTEMOLOGY.md](./doctrine/EPISTEMOLOGY.md): what counts as truth
  and how memory stays subordinate to receipts
- [doctrine/AUTHORITY.md](./doctrine/AUTHORITY.md): what the operator may do,
  what requires review, and what is forbidden
- [doctrine/EVOLUTION.md](./doctrine/EVOLUTION.md): the permitted order of
  improvement
- [state/priorities.md](./state/priorities.md): current operator priorities
- [state/capabilities.md](./state/capabilities.md): current strengths, limits,
  and trust posture
- [state/selection-policy.json](./state/selection-policy.json): machine-readable
  weights, thresholds, cooldowns, and selection contract
- [history/](./history): append-only public evolutionary record
- [reflections/](./reflections): append-only diagnosis and interpretation layer
- [site/](./site): Astro source for `aster.runx.ai`
- [docs/evolution.md](./docs/evolution.md): the intended evolutionary path
- [docs/operating-model.md](./docs/operating-model.md): the governance model
  for gradual self-improvement
- [docs/llm-training-spec.md](./docs/llm-training-spec.md): the selector and
  labeling contract for `aster` training rows
- [docs/run-catalog.md](./docs/run-catalog.md): each hosted lane, trigger, and
  emitted artifact
- [docs/backlog.md](./docs/backlog.md): the next bounded improvements worth
  pursuing
- [docs/sourcey.config.ts](./docs/sourcey.config.ts): Sourcey config for the
  optional working-docs surface
- [scripts/build-aster-context.mjs](./scripts/build-aster-context.mjs):
  assembles doctrine, state, history, reflections, and artifact signals into a
  bounded context bundle before the bridge calls the model
- [scripts/aster-cycle.mjs](./scripts/aster-cycle.mjs): the learned selector,
  durable control-state writer, and selector-training-row emitter for
  prerelease `v1`
- [scripts/aster-core.mjs](./scripts/aster-core.mjs): the unified lane
  runtime that assembles context, invokes the bridge, and writes promotion
  drafts
- [scripts/promote-aster-state.mjs](./scripts/promote-aster-state.mjs):
  materializes reflection/history draft packets from completed lane runs
- [scripts/apply-aster-promotions.mjs](./scripts/apply-aster-promotions.mjs):
  applies promotion drafts back into repo-owned `history/`, `reflections/`, and
  target dossier recent-outcomes sections
- [scripts/derive-evidence-projections.mjs](./scripts/derive-evidence-projections.mjs):
  rebuilds repo-owned memory projections from uploaded workflow artifacts and
  keeps them on one rolling draft PR
- [scripts/runx-agent-bridge.mjs](./scripts/runx-agent-bridge.mjs): external
  caller that answers `runx` `agent-step` requests without internal shortcuts
- [scripts/prepare-issue-triage-decision.mjs](./scripts/prepare-issue-triage-decision.mjs):
  converts a `support-triage` result into one explicit triage decision plus
  optional planning and worker requests
- [scripts/run-issue-triage-plan.mjs](./scripts/run-issue-triage-plan.mjs):
  runs `objective-decompose` when the triage approves planning and appends a
  phased plan summary to the issue comment
- [scripts/run-issue-triage-workers.mjs](./scripts/run-issue-triage-workers.mjs):
  executes one or more isolated `issue-to-pr` workers and publishes the
  resulting draft PRs
- [scripts/run-governed-pr-lane.mjs](./scripts/run-governed-pr-lane.mjs):
  reusable governed draft-PR runner for `fix-pr` and `docs-pr`
- [scripts/publish-runx-pr.mjs](./scripts/publish-runx-pr.mjs): reusable draft
  PR publisher for generated repo changes
- [scripts/operator-shakeout.mjs](./scripts/operator-shakeout.mjs): local
  shakeout for replay guard, PR policy, rollback, evidence routing, and the
  governed PR lanes

## Local Validation

For the public face and repo-owned operator state:

```bash
npm run check
npm run shakeout:local
npm --prefix site install
npm run site:build
```

If you are touching the optional working-docs surface as well:

```bash
npm run docs:build
```

Run the live proving-ground lane locally from this repo:

```bash
RUNX_ROOT=/home/kam/dev/runx bash scripts/proving-ground.sh
node scripts/summarize-proving-ground.mjs .artifacts/proving-ground
```

Run a real `runx` lane through the external caller bridge:

```bash
OPENAI_API_KEY=... \
RUNX_ROOT=/home/kam/dev/runx \
node scripts/runx-agent-bridge.mjs \
  --runx-root /home/kam/dev/runx \
  --receipt-dir .artifacts/issue-triage/manual \
  -- \
  skill /home/kam/dev/runx/oss/skills/support-triage \
  --title "Example bounded issue" \
  --body "Describe the concrete repo problem here." \
  --source github_issue \
  --source_id 1 \
  --source_url https://github.com/nilstate/aster/issues/1
```

If you have prerecorded caller answers for a given proving-ground run, place
one JSON file per run name in `$RUNX_ANSWERS_DIR`:

```text
$RUNX_ANSWERS_DIR/
  evolve-introspect.json
  sourcey.json
  content-pipeline.json
```

The script will pick those up automatically and continue past the normal
`needs_resolution` boundary for that run.
