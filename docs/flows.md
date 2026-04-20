---
title: Hosted Flows
description: The concrete GitHub workflows that make aster a live runx proving-ground target.
---

# Hosted Flows

## `site-pages`

Builds and deploys `aster.runx.ai` from repo-owned operator content. This
keeps the public site live even when the external caller bridge is offline.

## `issue-triage`

This lane has two entry modes:

1. issue mode listens for every normal issue except `[skill]` proposals, runs
   `support-triage`, prepares one explicit triage decision, optionally runs
   `objective-decompose`, posts the triage comment back to the issue, and
   starts isolated `issue-to-pr` workers only when thread teaching
   authorizes bounded build work. Replay guard blocks duplicate reruns for the
   same issue fingerprint, and the live issue or PR thread is also parsed for
   reusable lessons, norms, and explicit gate authorizations. Canonical
   collaboration/thread-teaching issues are recognized as approval records and
   skipped before objective triage begins
2. PR mode builds a live PR snapshot, runs it through `github-triage`, and
   posts a maintainer comment back to the PR. Public-value and replay gates
   block low-signal or duplicate comments for the same head SHA. Generated
   derived-state refresh PRs are blocked before model work because they
   are review surfaces, not new triage subjects

## `evidence-projection-derive`

This lane is the replacement for per-event operator-memory publication.

It downloads uploaded workflow artifacts from `issue-triage` and `skill-lab`,
replays their promotion packets back into repo-owned `history/`,
`reflections/`, and target dossiers, records the processed artifact ids in
`state/evidence-projections.json`, and updates one rolling draft PR instead of
spawning one PR per event.

## `collaboration-record`

This lane is the dedicated approval-record surface for collaboration issues.

It listens for `[collaboration]` issues or explicit
`aster:thread-teaching-record` markers, validates the canonical record shape,
publishes an ops evidence row, and queues `thread-teaching-derive` when the
record is accepted.

Malformed collaboration issues fail closed. They are held for repair instead of
quietly turning into objective-triage runs.

## `fix-pr`

Runs on manual dispatch for one bounded bugfix request. The workflow checks out
the target repo, normalizes the request into the governed issue-to-PR contract,
runs the repo through the shared worker path, validates with the target's
verification profile, and opens a draft `runx/*` PR plus receipts. Publication
is hard-gated by a collaboration issue that authorizes `fix-pr.publish`.

## `docs-pr`

Runs on manual dispatch for one bounded docs or explanation request. The
workflow uses the same governed PR runner as `fix-pr`, but tightens the request
to docs-only changes before validation and draft PR publication. Publication is
hard-gated by a collaboration issue that authorizes `docs-pr.publish`. Hosted
provider work writes live trace files while the lane is running and the
workflow step carries an explicit timeout.

## `skill-lab`

Listens for issues whose title begins with `[skill]`, runs
`objective-to-skill`, materializes the result under `docs/skill-proposals/`,
and opens a draft PR with the generated proposal.

## `skill-upstream`

Runs on manual dispatch for an external target repo. The workflow checks out
the target, prepares a portable upstream `SKILL.md`, validates the contribution
artifacts and public language, uploads the artifact packet, and optionally
opens a draft PR against the target repo. When `publish=true`, the workflow
requires a collaboration issue that authorizes `skill-upstream.publish`.

The first proving-ground target is `nilstate/icey-cli`.

## `merge-watch`

Runs on schedule or manual dispatch, checks whether an upstream `SKILL.md`
contribution has moved, and emits the updated state plus any registry-binding
request packet.

## `proving-ground`

Runs bounded `runx` catalog calls against the repo to surface receipt,
governance, and evidence-quality drift.

## `generated-pr-policy`

Runs on generated `runx/*` pull requests and enforces the draft-only,
human-reviewed merge policy in the PR body and draft state.

## `rollback`

Runs only on manual dispatch and posts a corrective public comment or closes a
generated PR when an earlier aster output must be superseded.
