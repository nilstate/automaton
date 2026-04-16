# automaton

`automaton` is the canonical public dogfood destination for `runx`.

The docs in this repo are about `automaton` itself:

- what `automaton` is trying to become
- the philosophy that governs how it should behave
- how it should evolve under governance
- which live lanes are real today
- what evidence each lane should emit

The `runx` engine docs still belong in the `runx` repo. `automaton` is the
public target, not the place where the framework API and platform model should
be documented.

## Intention

`automaton` is meant to become a repo that can improve itself gradually in
public.

The story is not "an autonomous agent that silently rewrites itself."

The story is:

1. `runx` inspects `automaton`
2. `runx` proposes bounded changes and public updates
3. humans approve the next safe mutation
4. `automaton` improves gradually, with receipts

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

`automaton` now has four concrete live lanes:

- `sourcey-refresh`: `runx sourcey` authors and revises the Sourcey docs source
  bundle, then opens a draft PR
- `issue-supervisor`: a normal GitHub issue runs through `support-triage`; the
  supervisor posts a public triage comment, can run `objective-decompose` when
  the gate approves planning, and only then starts one or more repo-scoped
  `issue-to-pr` workers when the gate approves build
- `pr-triage`: a live PR snapshot runs through `github-triage`, then the
  workflow posts a maintainer comment back onto the PR
- `skill-learning`: a skill proposal issue runs through
  `objective-to-skill`, materializes a proposal in `docs/skill-proposals/`,
  and opens a draft PR

Two supporting lanes stay valuable even when the external caller is offline:

- `docs-pages`: builds and deploys the Sourcey site from committed docs sources
- `runx-dogfood`: keeps a draft-first receipt trail for the broader catalog

## Required Secrets

`automaton` needs only a small hosted secret surface:

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

- [docs/introduction.md](./docs/introduction.md): what `automaton` is trying to
  prove
- [docs/philosophy.md](./docs/philosophy.md): the doctrine behind the repo's
  behavior and safety boundaries
- [docs/evolution.md](./docs/evolution.md): the intended evolutionary path
- [docs/operating-model.md](./docs/operating-model.md): the governance model
  for gradual self-improvement
- [docs/run-catalog.md](./docs/run-catalog.md): each hosted lane, trigger, and
  emitted artifact
- [docs/backlog.md](./docs/backlog.md): the next bounded improvements worth
  pursuing
- [docs/sourcey.config.ts](./docs/sourcey.config.ts): Sourcey config for the
  public docs site
- [scripts/runx-agent-bridge.mjs](./scripts/runx-agent-bridge.mjs): external
  caller that answers `runx` `agent-step` requests without internal shortcuts
- [scripts/prepare-issue-supervisor-decision.mjs](./scripts/prepare-issue-supervisor-decision.mjs):
  converts a `support-triage` result into one explicit supervisor decision plus
  optional planning and worker requests
- [scripts/run-issue-supervisor-plan.mjs](./scripts/run-issue-supervisor-plan.mjs):
  runs `objective-decompose` when the supervisor approves planning and appends a
  phased plan summary to the issue comment
- [scripts/run-issue-supervisor-workers.mjs](./scripts/run-issue-supervisor-workers.mjs):
  executes one or more isolated `issue-to-pr` workers and publishes the
  resulting draft PRs
- [scripts/publish-runx-pr.mjs](./scripts/publish-runx-pr.mjs): reusable draft
  PR publisher for generated repo changes

## Local Validation

```bash
npm run check
npm run docs:build
```

Run the live dogfood lane locally from this repo:

```bash
RUNX_ROOT=/home/kam/dev/runx bash scripts/runx-dogfood.sh
node scripts/summarize-dogfood.mjs .artifacts/runx-dogfood
```

Run a real `runx` lane through the external caller bridge:

```bash
OPENAI_API_KEY=... \
RUNX_ROOT=/home/kam/dev/runx \
node scripts/runx-agent-bridge.mjs \
  --runx-root /home/kam/dev/runx \
  --receipt-dir .artifacts/sourcey-refresh \
  --approve sourcey.discovery.approval \
  -- \
  skill /home/kam/dev/runx/oss/skills/sourcey \
  --project /home/kam/dev/automaton
```

If you have prerecorded caller answers for a given dogfood run, place one JSON
file per run name in `$RUNX_ANSWERS_DIR`:

```text
$RUNX_ANSWERS_DIR/
  evolve-introspect.json
  sourcey.json
  content-pipeline.json
```

The script will pick those up automatically and continue past the normal
`needs_resolution` boundary for that run.
