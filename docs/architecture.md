---
title: Architecture
description: The full-shape plan for aster, its memory model, and its boundary with runx.
---

# Architecture

This document is the execution plan for `aster`.

The doctrine in [philosophy.md](./philosophy.md) and the stage model in
[evolution.md](./evolution.md) stay intact. This page answers the harder
question those docs do not fully answer on their own: what exactly owns what,
where memory lives, when SQL enters, and how `aster` improves without
turning `runx` into an `aster`-specific system.

The constitutional doctrine in `doctrine/` is part of this plan, not an
optional style preference.

`doctrine/MISSION.md` is the bridge between the constitutional layer and the
operational layer: it defines what kinds of public actions actually prove the
`runx` thesis rather than merely generating activity.

`doctrine/EXAMPLES.md` turns that mission into contrasted positive and negative
patterns so the model can compare candidate actions against real shapes instead
of only abstract rules.

## Identity

`aster` is the operator identity.

The name is fixed across repo, directory, site, workflows, schemas, evidence, and public surfaces.
No deprecated operator names should remain in system-owned active surfaces.

## Hard Boundary

`runx` is the governed runtime.

It may own:

- skills, chains, grants, approvals, receipts, artifacts
- generic hosted execution
- generic hosted memory primitives
- generic receipt indexing and retrieval

It must not own:

- `aster` doctrine
- `aster` target selection
- `aster` priorities or taste
- `aster` capability map
- `aster` public narrative

`aster` is a separate operator built on top of `runx`.

It owns:

- what work is worth doing
- how public progress is narrated
- how targets are selected and cooled down
- how failures become better docs, context, and skills
- what should appear on `aster.runx.ai`

The rule is simple:

- `runx` may host the machine
- `aster` owns the mind

## Topology

The current full shape is:

- `runx/oss`: primitive runtime, CLI, skill execution, receipts, local memory
- `runx/cloud`: generic hosted execution, receipt store, auth, generic hosted memory
- `aster`: proving ground, operator docs, artifacts, workflows, and the future operator face

The hosted story can include memory and persistence, but the ownership stays
generic:

- `runx` may expose a hosted memory substrate
- `aster` may store or retrieve through that substrate
- the stored meanings remain `aster`'s meanings, not `runx` product nouns

## Current Reality

The repo already has a real current shape. The plan should start there instead
of pretending this is greenfield:

- `docs/` is the current planning and operator-docs surface
- `.artifacts/proving-ground/` and other `.artifacts/` trees are the current
  layer-0 evidence surface
- `.github/workflows/` contains the live lanes
- the skill-upstream and watcher work already produce real artifacts and
  upstream state

The target shape below is not a claim that the repo already looks like that. It
is the planned convergence shape.

## Public Face

`aster.runx.ai` should stay separate from `runx.ai`.

That split is important:

- `runx.ai` is the runtime, registry, receipt, and hosted-platform face
- `aster.runx.ai` is the operator face

The target 10/10 face is a dedicated `site/` app in the `aster` repo. That
site should present:

- thesis and current posture
- live priorities with rationale
- evolutionary history
- capabilities and trust posture
- selected history and reflections
- target context from `state/`

Canonical receipts and generic run evidence should still resolve through
`runx` surfaces. `aster` links to them; it does not redefine them.

`aster` does not need a Sourcey public docs site as part of the intended
end state.

The rule is:

- `docs/` may continue to exist as working docs during planning and migration
- `site/` is the intended public face
- Sourcey is optional tooling, not part of the 10/10 architecture

## Public Identity

The site may present `aster` as a thesis-driven operator.

GitHub interaction should not.

The intended split is:

- `aster.runx.ai` explains the operator system
- GitHub comments, reviews, issues, and pull requests should read as Kam using tools

That means:

- `aster` is the backstage cognition and preparation layer
- Kam is the public accountable identity on GitHub
- public threads should not be asked to parse internal operator theater
- internal nouns like `lane`, `receipt`, `operator memory`, and `workflow` are not part of the intended outward voice

The standard for a public GitHub action is not "can the system produce a
comment?" It is "would a maintainer rather hear this from Kam than from a
robot?"

## Repo Shape

The target `aster` repo shape is:

```text
aster/
  doctrine/             constitutional docs, human-reviewed
  state/                learned layer, aster-maintained
    targets/            target context packs and trust posture notes
  history/              append-only public records
  reflections/          append-only diagnosis records
  site/                 Astro site for aster.runx.ai
  scripts/              workflows, bridge scripts, validation tools
  schemas/              machine-readable packets and internal contracts
  .artifacts/           raw receipts, workflow packets, and transient evidence
  docs/                 working docs during planning and migration
```

The ownership rule inside the repo is:

- `doctrine/` is constitutional and human-reviewed
- `state/` is the learned layer and current operator context
- `history/` records what happened
- `reflections/` records why it worked or failed
- `site/` renders those materials plus selected live generic data
- `.artifacts/` is the raw evidence and replay surface, not the narrative layer
- `docs/` exists for planning and internal operator context, not as the
  intended public face

## Public Authorship

The public authorship plan is:

- public GitHub actions are authored as Kam
- `aster` may draft, rank, summarize, and prepare
- any public output must be held to the standard of something Kam would
  actually say under his own name
- if that standard is not met, the system should choose `no_op`

This is a trust decision, not merely a copywriting decision.

## Repo Migration

The migration should be explicit:

1. keep the current `docs/` planning surface honest
2. move constitutional content into `doctrine/`
3. create `state/` for machine-maintained current context
4. create `history/` and `reflections/` as append-only public records
5. build `site/` as the new primary face
6. keep `.artifacts/` as raw evidence throughout

`docs/` is therefore current reality, not final shape.

`site/` is now the only public-face deployment path. `docs/` may still exist as
working docs, but it no longer has a dedicated refresh lane.

## Lane Contract

Each lane must have one bounded artifact, one approval mode, and one memory
effect.

| lane | purpose | input | output | public artifact | approval mode | feed eligible | memory effect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `issue-triage` | route issue before mutation | issue body, repo state | triage comment, optional worker requests | Kam-voiced issue comment, receipts | triage gate | yes | append routing and failure notes |
| `issue-triage` | review inbound PRs | PR snapshot | maintainer comment | Kam-voiced PR comment, receipts | workflow gate | yes | capture review patterns |
| `fix-pr` | land one bounded repo bugfix as a governed draft PR | bounded request, target repo state, verification profile | normalized request, draft PR, validation report | draft PR, receipts | draft-only | yes | record repeated fix classes and verification outcomes |
| `docs-pr` | land one bounded docs or explanation change as a governed draft PR | bounded docs request, target repo state, verification profile | normalized request, draft PR, validation report | draft PR, receipts | draft-only | yes | record narrative drift and docs repair outcomes |
| `skill-lab` | turn repeated need into a skill proposal | issue, receipts, repo evidence | proposal markdown, draft PR | draft PR, receipts | draft-only | yes | grow explicit capabilities |
| `skill-upstream` | contribute portable skill docs upstream | target repo evidence | `SKILL.md`, contribution packet, draft PR | upstream draft PR, receipts | draft-only | yes | record upstream adoption attempt |
| `merge-watch` | observe upstream result | PR state, checks, merge metadata | state packet, binding request | proof record, receipts | read-only | yes | confirm acceptance or rejection |
| `proving-ground` | preserve broad receipt visibility | selected run catalog | receipt bundles, summaries | receipt trail | no mutation | no | expose repeated failure classes |
| `market-brief` | summarize external market movement | supplied research set | brief markdown | published brief | explicit approval | later | update external context |

Any lane with a public GitHub artifact must also satisfy the public-voice
contract in [../doctrine/VOICE.md](../doctrine/VOICE.md) and
[../doctrine/CONDUCT.md](../doctrine/CONDUCT.md).

## Canonical, Derived, Public

Not every useful thing is canonical.

| class | examples | owner | storage | mutability |
| --- | --- | --- | --- | --- |
| canonical evidence | receipts, approvals, artifacts, workflow packets | `runx` or the lane producer | receipt/artifact store | append-only |
| constitutional docs | thesis, conduct, voice, epistemology, authority, evolution | `aster` maintainers | git | review-only |
| derived context | summaries, extracted facts, retrieval notes, indexes | `aster` | local cache or hosted generic memory | replaceable |
| operator projections | targets, opportunities, priorities, capabilities | `aster` | `state/` first, store later | revisable |
| public narrative | site pages, history, reflections | `aster` | git + site build | append-first |

The important rule is that derived context can be thrown away and rebuilt from
canonical evidence. That keeps `aster` legible when memory inevitably gets
smarter.

Issues and PRs are therefore not "memory." They are canonical provider-thread
evidence. `aster` uses them to project derived context, lessons, and policy
state, but the thread remains the stronger layer.

## Subject Identity

The hosted memory layer needs one stable subject model or it will rot.

The generic subject contract should be:

- namespace-scoped uniqueness on `(subject_kind, subject_locator)`
- `subject_kind`: a namespace-defined lowercase token
- `subject_locator`: the stable canonical identifier inside that namespace
- optional `subject_facet`: a stable subview such as `summary`, `timeline`, or
  `context`
- optional `canonical_uri`: externally meaningful canonical URL or URI
- optional aliases, which may be added but do not replace the canonical locator

`runx` should not define operator-specific subject kinds. It only defines the
shape. Namespace owners define the kinds they need.

For `aster`, likely subject kinds include:

- `repo`
- `issue`
- `pull_request`
- `skill`
- `target`
- `brief`
- `run_class`

Those are `aster` meanings, not `runx` nouns.

## Memory Model

`aster` should not jump straight to an operator-specific database.

It should grow memory in layers:

### Layer 0: Receipt-grounded context

Use:

- repo files
- receipt links
- `.artifacts/` workflow artifacts and receipt bundles
- human-written docs

This is enough to prove the loop and keep the system inspectable.

### Layer 1: Git-native operator memory

Add:

- `history/` entries
- `reflections/` entries
- `state/targets/`
- generated summaries checked into the repo only when they are worth reviewing
  as compact, intentionally batched changes rather than one PR per live event

This is still small, legible, and rebuildable.

### Layer 2: Derived local working memory

Add:

- local indexes
- retrieval bundles
- extracted facts
- compact rolling summaries

This layer exists to help the next run, not to become a second source of truth.

### Layer 3: Generic hosted memory

Once history, concurrency, or retrieval pressure justifies it, `runx` may host
a generic memory substrate. The generic hosted primitives should look like:

- `memory_namespace`
- `memory_subject`
- `memory_entry`
- `memory_link`
- `memory_snapshot`

The primitives mean:

- `memory_namespace`: the tenancy boundary and ownership root
- `memory_subject`: the stable thing the memory is about
- `memory_entry`: an append-only observed or inferred record
- `memory_link`: a typed relationship across subjects, entries, or receipts
- `memory_snapshot`: a replaceable materialized view built from entries

Each memory entry should support:

- content
- kind
- provenance
- timestamp
- confidence
- freshness
- visibility
- optional embedding/vector index

This is a runtime service, not an `aster` schema.

### Hosted Access Model

`aster` should not receive a broad shared `runx` admin key.

The planned access model is:

- `aster` gets its own `runx` service principal
- preferred auth is GitHub OIDC token exchange for short-lived hosted tokens
- fallback auth is a rotated service token scoped to the same principal
- scopes stay narrow: `memory:read`, `memory:write`, `memory:query`,
  `memory:snapshot:publish`, `receipt:read`
- namespace ACLs restrict the principal to its own memory namespaces

Namespace access should use explicit roles:

- `namespace_reader`
- `namespace_writer`
- `snapshot_publisher`
- `namespace_admin`

Cross-namespace reads or writes should require an explicit time-bounded grant.

The public site must not use privileged memory credentials in the browser.

The public face should read either:

- public receipts
- published public snapshots
- or build-time exported state prepared by trusted workflows

## Write Semantics

The hosted memory layer should expose two different write classes:

### Entries

Entries are append-only.

Rules:

- no in-place mutation
- no destructive delete
- corrections create a new entry linked to the corrected entry
- redactions create a redaction record and hide content through policy, not by
  pretending the write never happened
- every write carries provenance or an explicit `source=human_input` marker
- every write uses an idempotency key

### Snapshots

Snapshots are replaceable materialized views.

Rules:

- snapshots are derived from entries, links, receipts, or artifacts
- a snapshot update replaces the current materialized view for that
  `(namespace, subject, snapshot_kind)`
- prior snapshot versions remain auditable in metadata even if only the latest
  is served by default
- snapshots may be public or private; entries are never implicitly public

## Provenance, Redaction, Audit

The memory layer is not acceptable without explicit governance:

- every entry, link, and snapshot write records actor principal, namespace,
  subject, source receipt ids, and timestamp
- every privileged read or query is audit logged
- redaction policy runs before publication and before public reads
- public snapshots must carry the materialization watermark and provenance set
- no derived memory write may exist without traceable provenance or explicit
  human authorship

## Rebuild And Compaction

Derived memory must never become a black box.

Rules:

- entries and links remain rebuildable from canonical evidence for as long as
  retention policy permits
- snapshots are always disposable and rebuildable
- compaction may reduce duplicate derived entries, but it must preserve
  provenance and correction history
- canonical receipts and raw artifacts are never compacted into summaries and
  then discarded as if the summary were equivalent

## Public Snapshot Export

The public site should consume published snapshots, not privileged live memory
reads.

The export contract should require:

- `snapshot_id`
- `namespace`
- `subject`
- `snapshot_kind`
- `generated_at`
- `materialized_from`
- `public_visibility`
- provenance links back to receipts or artifacts

Publication should be an explicit step performed by an authorized publisher
principal, not a side effect of any memory write.

## Memory API Contract

The generic hosted memory layer should expose a small, strict contract:

- `appendEntry(namespace, subject, entry, idempotency_key)`
- `appendLink(namespace, src, dst, link, idempotency_key)`
- `queryEntries(namespace, subject_selector, filters)`
- `materializeSnapshot(namespace, subject, snapshot_kind, materialized_from)`
- `publishSnapshot(namespace, subject, snapshot_kind, snapshot_id)`
- `readPublishedSnapshot(namespace, subject, snapshot_kind)`

The contract rules are:

- append operations are idempotent on `(namespace, idempotency_key)`
- append operations never mutate existing entries or links
- publish is explicit and auditable
- public reads only touch published snapshots or public receipts
- raw privileged query is never a browser primitive

### Layer 4: Operator projections

`aster` then builds its own meanings on top:

- targets
- opportunities
- priorities
- capability map
- cooldowns
- reflections

Those may eventually live in SQL, but if they do, they should live as
`aster`-owned projections over generic evidence and generic memory. They
must not become hard-coded `runx` product nouns.

## Does Aster Need SQL?

Not immediately.

`aster` can operate for a while with:

- repo docs
- append-only history
- reflections
- `state/targets/`
- receipt links
- generated summaries

SQL becomes justified when `aster` needs:

- shared context across concurrent cycles
- retrieval over large receipt histories
- cooldowns, dedupe, retry budgets, and ranking
- stable derived memory independent of markdown layout
- fast selection over many targets and many past outcomes

The boundary remains:

- if `runx` hosts SQL, it hosts generic memory primitives
- if `aster` needs richer operator tables, those belong to `aster`

## Retention Policy

The system needs concrete retention classes, not hand-waving:

- canonical receipts and referenced artifacts: retain for at least `365d`,
  longer when referenced by public history, reflections, or published snapshots
- derived entries: retain for at least `180d` after supersession
- snapshots: retain current plus prior published versions for at least `30d`
- audit logs for privileged memory operations: retain for at least `365d`

These are minimum architectural defaults. Product tiers may extend them, but
the design should not depend on shorter windows.

## Context Assembly

Every meaningful run should assemble context in the same order:

1. read the repo and issue/PR/target surface
2. fetch relevant receipts and artifacts
3. pull any derived memory entries that match the subject
4. build one bounded context bundle
5. run one lane
6. write receipts first
7. write reflection and projection updates second

That ordering matters. It keeps `aster` grounded in evidence before it
updates its own beliefs.

The implemented context path now lives in:

- `scripts/build-aster-context.mjs`
- `scripts/aster-core.mjs`
- `scripts/promote-aster-state.mjs`
- `scripts/apply-aster-promotions.mjs`
- `scripts/derive-evidence-projections.mjs`

Doctrine is loaded in a stable priority order. Relevant reflections now load as
full content when the subject matches; unrelated reflections stay excerpt-only.
The constitutional layer stays in `doctrine/`. Exact scoring weights,
thresholds, and cooldowns live in `state/selection-policy.json`.

## Selection Loop

The selector is now a real operator component, not just a plan:

- `scripts/aster-cycle.mjs` discovers candidates, scores them, and selects
  one bounded lane or `no_op`
- `.github/workflows/aster-cycle.yml` runs the assess/discover/score/select
  cycle on GitHub
- target dossiers in `state/targets/` provide default-lane posture and recent
  outcomes used for cooldowns
- curated target dossiers, not repo-name prefixes, are now the real external
  scope boundary for public comment/review lanes

The current discovery surface is:

- open GitHub issues
- open GitHub pull requests
- bounded maintenance opportunities such as `proving-ground`

The current scoring authority is `state/selection-policy.json`, not older plan
text.

## Self-Improvement Direction

`aster` should improve in a fixed order:

1. sharpen docs
2. sharpen context retrieval
3. sharpen review and routing quality
4. sharpen lane packaging
5. only then widen authority

That prevents the common failure mode where a system adds more power before it
has learned how to understand its own history.

The preferred response to repeated failure is:

1. improve the dossier
2. improve the prompt or packet shape
3. improve the skill or lane contract
4. add a new store or retrieval path only if the earlier fixes are exhausted

## Aster Core Update Rules

The core of `aster` must update itself under explicit filesystem rules:

### `doctrine/`

- human-reviewed only
- machine proposals allowed through draft PRs
- no direct autonomous mutation

### `state/`

- machine-maintained current projections
- replace-in-place allowed when provenance is preserved
- every state update must point back to receipts, artifacts, or reflections
- state should stay compact and current, not become an append-only dump
- concurrent state updates must use optimistic concurrency against the last
  known state version or snapshot id
- conflicting writers must fail closed and emit a reflection or correction path

### `history/`

- append-only public event log
- one meaningful event per entry
- no silent edits; corrections require a new correction entry
- history entries should only be promoted from state or reflections when the
  event would matter to a public operator audience

### `reflections/`

- append-only diagnosis records
- each reflection names the lane, the evidence, the failure or success class,
  and the next corrective action
- reflections may supersede earlier views but do not rewrite them
- reflections may update `state/` only through an explicit promotion rule

### `site/`

- render-only
- no canonical truth lives here
- site content is projected from doctrine, state, history, reflections, and
  public snapshots

## Promotion Rules

The aster core should promote information in one direction:

1. receipt or artifact
2. reflection
3. `state/`
4. `history/`
5. `site/`

Rules:

- nothing enters `state/` without evidence or a reflection grounded in evidence
- nothing enters `history/` unless it is externally meaningful or durable
- the `site/` renders from `state/`, `history/`, `reflections/`, and public
  snapshots; it does not invent new canonical facts

## Execution Surface Parity

Approval logic should not rely only on branch names, folder convention, or
human intuition. Mutating lanes should classify the surfaces they touch and
carry that classification into their publication policy.

For `aster` itself:

- promotion flows may write only to `state/targets/`, `history/`, and `reflections/`
- promotion flows must never write to `doctrine/`
- generated PR lanes must classify staged changes into constitutional,
  learned-state, public-memory, public-face, docs, runtime, and repo-meta
  surfaces before publication
- lane policy must fail closed when the staged surface mix does not match the
  lane's allowed surfaces

That means:

- `issue-triage` should treat receipts, uploaded artifacts, and canonical
  collaboration issues as the durable record
- `evidence-projection-derive` may refresh learned-state, public-history, and
  reflection surfaces, but only as a compact derived projection over canonical
  artifacts and only through one rolling draft PR
- `docs-pr` may touch docs/public-face surfaces, but not doctrine or learned-state
- `fix-pr` may touch runtime surfaces, but not doctrine or learned-state

The publication policy should travel with the PR body and publication artifact
so reviewers can see not just that a PR was generated, but what kind of repo
surface it was allowed to change.

## Site Information Architecture

The 10/10 public face should have a small, stable route contract:

- `/` — thesis, current posture, latest proof, current stage
- `/doctrine` — constitutional doctrine, mission, and examples
- `/activity` — split public-proof feed and ops/status feed
- `/priorities` — live priorities and rationale from `state/`
- `/history` — append-only public history
- `/capabilities` — current lanes, trust posture, and capability inventory
- `/reflections` — selected public reflections
- `/targets/[slug]` — public target context where appropriate

The public-face split is now explicit:

- main feed: thesis-relevant public proofs
- ops/status feed: selector runs, builds, proving-ground, and operational exhaust

Every page should point back to receipts, snapshots, or public artifacts.

## Recovery Drills

The system should define recovery before it needs it:

- bad snapshot publish: unpublish, restore previous published snapshot, append a
  correction history entry
- corrupted derived memory: rebuild snapshots and indexes from retained
  canonical evidence
- conflicting state writes: reject the second write, emit a reflection, and
  require a new state recomputation
- broken site projection: fall back to last known published snapshot set

## Milestones

The staged build order should be:

### v0: Proving Ground

- live lanes are real
- receipts exist
- public docs match reality
- no fake autonomy language

### v1: Git-native memory

- history and reflections are append-only
- `state/targets/` exists
- public priorities and capabilities are written from repo state

### v2: Generic hosted memory

- `runx` exposes generic memory primitives
- `aster` retrieves receipt-grounded memory through a generic interface
- `aster` authenticates through a service principal, not a broad shared key
- no `aster_*` tables appear in `runx`

### v3: Operator projections

- `aster` maintains targets, priorities, and capabilities as first-class projections
- selection and cooldown logic become durable
- the site shows live operator state without pretending that projections are receipts

### v4: External portfolio

- `aster` handles a bounded set of external targets
- upstream contributions, advisories, and briefs become routine
- the public face shows why each action was worth taking

## 10/10 Standard

At this point the remaining work is execution quality, not missing architecture.

The system is 10/10 only when:

- the implemented behavior matches these contracts exactly
- every public claim resolves back to evidence
- every derived layer can be rebuilt or corrected without fiction
- the operator face is beautiful without becoming opaque

## Decision Rule

When there is doubt about where something belongs, ask one question:

Is this a generic primitive that another operator could use unchanged?

- if yes, it may belong in `runx`
- if no, it belongs in `aster`

That is the boundary that keeps the system beautiful instead of collapsing into
one repo that knows too much.
