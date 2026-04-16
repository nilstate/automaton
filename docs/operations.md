---
title: Operations
description: Secrets, approvals, artifacts, and what still needs hardening.
---

# Operations

## Required secrets

- `OPENAI_API_KEY`: external caller for `runx` `agent-step` requests
- `RUNX_CALLER_MODEL` (optional repo variable): pinned model snapshot for the
  hosted bridge
- `RUNX_REPOSITORY_PAT` (optional secret): GitHub token for private `runx`
  checkout and other cross-repo automation that cannot rely on the default
  workflow token
- `UPSTREAM_CONTRIBUTION_TOKEN` (optional secret): preferred token for
  cross-repo `skill-contribution` PRs when the default workflow token cannot
  write to the target repo. This should be an `auscaster` token when outbound
  adoption PRs should be authored and opened as `@auscaster`.

## Approval policy

Approvals stay explicit:

- Sourcey authoring auto-approves only `sourcey.discovery.approval`
- Issue supervision comments first; `objective-decompose` may run when the
  supervisor gate approves planning, and one or more repo-scoped `issue-to-pr`
  workers start only after the supervisor gate approves build
- PR triage writes comments only through the dedicated workflow
- Skill-learning opens draft PRs only
- Skill-contribution opens draft PRs only, and upstream changes are limited to
  portable `SKILL.md` unless a maintainer explicitly requests more
- Skill-contribution-watch is read-only against upstream repos. It records PR
  state, checks, merge commit, and upstream blob metadata, then emits an
  internal registry-binding request after merge.

## Artifact policy

Every mutating or public lane uploads:

- the final `runx` JSON result
- the receipts directory
- provider traces for each `agent-step`

That makes failures diagnosable and keeps the trust boundary visible.

## Still missing

- provider failover and key rotation
- stronger evals for comment quality and PR usefulness
- a merge and rollback policy for generated PRs
- persistent tracking for upstream skill contribution state beyond the current
  artifact packet
- persistent receipt indexing outside workflow artifacts
