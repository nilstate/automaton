# Run Catalog

This is the live run catalog for `aster`.

## Live Mutation And Comment Lanes

### `issue-triage`

- trigger: GitHub issues except `[skill]` proposals, plus PR `opened`,
  `reopened`, `ready_for_review`, and `synchronize`
- issue command chain:
  1. `support-triage`
  2. `issue-triage`
  3. optional `objective-decompose`
  4. optional `issue-to-pr` worker fanout
  5. draft PR publication per worker
- PR command: `runx skill <runx>/skills/github-triage --runner respond`
- purpose: make issue and PR routing public before mutation, start bounded
  workers only after thread teaching authorizes build, keep PR review legible,
  and dedupe repeated issue or PR events before public output
- output: triage comment, triage decision artifact, optional archived scafld
  specs, promotion packet drafts inside uploaded artifacts, receipts, draft PRs,
  issue backlink comments, posted PR comments, comment evals, generated-PR
  evals, and active thread-teaching context
- boundary: generated derived-state PRs such as evidence-projection refreshes
  are blocked from PR-mode `issue-triage`; they remain review surfaces only

### `collaboration-record`

- trigger: GitHub issues titled `[collaboration] ...`, issues containing the
  canonical `aster:thread-teaching-record` marker, plus manual dispatch
- command: `node scripts/build-collaboration-record-packet.mjs`
- purpose: validate canonical collaboration records as approval evidence,
  publish an ops-visible receipt row, and queue `thread-teaching-derive`
- output: collaboration packet, validation status, public evidence row, queued
  derive refresh, uploaded issue artifact packet

### `skill-lab`

- trigger: GitHub issues whose title begins with `[skill]`
- command: `runx skill <runx>/skills/objective-to-skill`
- purpose: turn a proposed new capability into a concrete skill package
  proposal, materialize it under `docs/skill-proposals/`, and open a draft PR
- output: proposal markdown, raw packet JSON, receipts, promotion packet
  drafts inside uploaded artifacts, and draft PR

### `evidence-projection-derive`

- trigger: scheduled every six hours, plus manual dispatch
- command: `node scripts/derive-evidence-projections.mjs`
- purpose: rebuild repo-owned `history/`, `reflections/`, target dossier recent
  outcomes, and `state/evidence-projections.json` from uploaded GitHub Actions
  artifacts instead of mutating those surfaces inline during issue-triage
- output: rolling draft PR, projection state file, artifact-derive report, and
  uploaded derive artifacts

### `fix-pr`

- trigger: manual workflow dispatch
- command: `node scripts/run-governed-pr-lane.mjs --lane fix-pr`
- purpose: turn one bounded bugfix request into a validated draft `runx/*` PR
  outside issue-triage worker fanout
- gate: requires a collaboration issue authorizing `fix-pr.publish`
- output: normalized request packet, verification report, receipts, draft PR,
  generated-PR eval, change-surface policy, and live provider-trace heartbeat
  files while hosted caller work is in flight

### `docs-pr`

- trigger: manual workflow dispatch
- command: `node scripts/run-governed-pr-lane.mjs --lane docs-pr`
- purpose: turn one bounded docs or explanation request into a validated draft
  `runx/*` PR while constraining the mutation to docs-only scope
- gate: requires a collaboration issue authorizing `docs-pr.publish`
- output: normalized request packet, verification report, receipts, draft PR,
  generated-PR eval, change-surface policy, and live provider-trace heartbeat
  files while hosted caller work is in flight

### `skill-upstream`

- trigger: manual workflow dispatch
- command: `node scripts/prepare-skill-upstream.mjs` followed by
  `node scripts/validate-skill-upstream.mjs`
- purpose: add a portable upstream `SKILL.md` to a target repo without adding
  runx-specific binding files
- gate: requires a collaboration issue authorizing `skill-upstream.publish`
- first target: `nilstate/icey-cli`
- output: target `SKILL.md`, contribution artifact packet, PR body, optional
  draft PR, public evidence row

### `merge-watch`

- trigger: scheduled and manual workflow dispatch
- command: `node scripts/merge-watch.mjs`
- purpose: observe upstream PR state after a portable `SKILL.md` contribution
  and hand accepted skills to runx registry binding
- first target: `nilstate/icey-cli#2`
- output: `skill_upstream_state.json`, proof-wall event, and
  `registry_binding_request.json` after upstream merge

## Continuous Support Lanes

### `site-pages`

- trigger: push to `main` affecting docs sources, or manual dispatch
- command: `npm run site:build`
- purpose: publish the public `aster.runx.ai` site
- output: GitHub Pages deployment from `site/dist`

### `proving-ground`

- trigger: scheduled and manual workflow dispatch
- purpose: keep broader receipt and envelope visibility across the catalog even
  when live mutation lanes are unavailable
- current profile:
  - `evolve-introspect`
  - `sourcey`
  - optional broader research/content lanes when the checked-out `runx` ref
    includes them

### `generated-pr-policy`

- trigger: generated `runx/*` PR events, plus manual dispatch
- command: `node scripts/enforce-generated-pr-policy.mjs`
- purpose: keep generated PRs draft-only and explicitly human-reviewed
- output: policy-enforcement artifact plus any corrective PR body/comment update
- note: publication now also carries a change-surface policy describing which
  repo surfaces the generated branch touched

### `rollback`

- trigger: manual workflow dispatch
- command: `node scripts/rollback-run.mjs`
- purpose: publish a corrective comment or close a generated PR when a prior
  aster output was wrong
- output: rollback artifact plus the public correction or closure action

## Next Lanes

These are still missing or intentionally deferred:

- `skill-recon` for explicit skill research packets before adoption work starts
- `trust-audit` for public evaluation of lanes, targets, and skills
- `market-brief` for periodic ecosystem briefs with explicit source sets
