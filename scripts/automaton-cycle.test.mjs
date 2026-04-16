import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  buildDispatchPlan,
  discoverOpportunities,
  loadScoringPolicy,
  runAutomatonCycle,
  scoreOpportunities,
  selectOpportunity,
} from "./automaton-cycle.mjs";

test("loadScoringPolicy parses weights, thresholds, and cooldowns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-scoring-"));
  const scoringPath = path.join(tempRoot, "SCORING.md");
  await writeFile(
    scoringPath,
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  const policy = await loadScoringPolicy(scoringPath);

  assert.equal(policy.weights.stranger_value, 0.24);
  assert.equal(policy.thresholds.stranger_value_min, 0.6);
  assert.equal(policy.thresholds.minimum_select_score, 0.68);
  assert.equal(policy.cooldown_hours.success, 72);
  assert.equal(policy.cooldown_hours.ignored, 168);
});

test("discover, score, and select curated external targets inside prerelease v1", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-cycle-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-automaton.md"),
    [
      "---",
      "title: Target Dossier — nilstate/automaton",
      "subject_locator: nilstate/automaton",
      "---",
      "",
      "# nilstate/automaton",
      "",
      "## Default Lanes",
      "",
      "- `issue-supervisor`",
      "- `pr-triage`",
      "- `sourcey-refresh`",
      "- `runx-dogfood`",
      "",
      "## Recent Outcomes",
      "",
      "- 2026-04-16 · `sourcey-refresh` · `completed` · recent refresh",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(repoRoot, "state", "targets", "vercel-next-js.md"),
    [
      "---",
      "title: Target Dossier — vercel/next.js",
      "subject_locator: vercel/next.js",
      "---",
      "",
      "# vercel/next.js",
      "",
      "## Default Lanes",
      "",
      "- `pr-triage`",
      "- `issue-supervisor`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/automaton": {
          issues: [],
          prs: [],
        },
        "vercel/next.js": {
          issues: [],
          prs: [
            {
              number: 101,
              title: "docs: fix broken app router example",
              body: "Small fix with public impact.",
              url: "https://github.com/vercel/next.js/pull/101",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T00:00:00Z",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "vercel/next.js");
  assert.equal(result.selection.selected.lane, "pr-triage");
  assert.match(result.selection.priorities[0].subject_locator, /vercel\/next\.js#pr\/101/);
  assert.equal(result.selection.priorities[0].within_v1_scope, true);
  assert.equal(result.selection.priorities[0].vetoed, false);
});

test("scoreOpportunities enforces cooldowns from target dossiers", async () => {
  const policy = {
    weights: {
      stranger_value: 0.24,
      proof_strength: 0.24,
      compounding_value: 0.19,
      tractability: 0.16,
      novelty: 0.09,
      maintenance_efficiency: 0.08,
    },
    thresholds: {
      stranger_value_min: 0.6,
      proof_strength_min: 0.7,
      minimum_select_score: 0.68,
    },
    cooldown_hours: {
      success: 72,
      ignored: 168,
      rejected: 504,
      failed: 24,
    },
  };

  const opportunities = [
    {
      id: "maintenance-sourcey-refresh",
      lane: "sourcey-refresh",
      source: "maintenance",
      title: "Refresh docs",
      summary: "Refresh docs",
      subject_locator: "nilstate/automaton",
      target_repo: "nilstate/automaton",
      stale_days: 0.2,
      dossier: {
        default_lanes: ["sourcey-refresh"],
        recent_outcomes: [
          {
            date: "2026-04-16",
            lane: "sourcey-refresh",
            status: "completed",
            summary: "recent refresh",
          },
        ],
      },
      memory_records: [],
    },
  ];

  const scored = scoreOpportunities({
    opportunities,
    dossiers: {
      "nilstate-automaton": opportunities[0].dossier,
    },
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });

  assert.equal(scored[0].vetoed, true);
  assert.match(scored[0].veto_reasons.join(","), /cooldown/);
});

test("buildDispatchPlan dispatches curated external opportunities", () => {
  const plan = buildDispatchPlan({
    repo: "nilstate/automaton",
    dispatchRef: "main",
    selection: {
      status: "selected",
      reason: "highest_non_vetoed_score",
      priorities: [],
      selected: {
        lane: "pr-triage",
        target_repo: "vercel/next.js",
        subject_locator: "vercel/next.js#pr/101",
        pr_number: "101",
        score: 0.81,
      },
    },
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.lane, "pr-triage");
  assert.equal(plan.workflow, "pr-triage.yml");
  assert.equal(plan.inputs.target_repo, "vercel/next.js");
  assert.equal(plan.inputs.pr_number, "101");
});

test("runAutomatonCycle vetoes candidates with an open operator-memory PR", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-open-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "astral-sh-uv.md"),
    [
      "---",
      "title: Target Dossier — astral-sh/uv",
      "subject_locator: astral-sh/uv",
      "---",
      "",
      "# astral-sh/uv",
      "",
      "## Default Lanes",
      "",
      "- `pr-triage`",
      "- `issue-supervisor`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "astral-sh/uv": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/astral-sh/uv/issues/202",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T10:00:00Z",
            },
          ],
          prs: [
            {
              number: 101,
              title: "docs: tighten resolver validation",
              body: "Small external PR.",
              url: "https://github.com/astral-sh/uv/pull/101",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T12:00:00Z",
              headRefName: "feature/docs-fix",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    openOperatorMemoryBranches: ["runx/operator-memory-pr-triage-astral-sh-uv-pr-101"],
    now: "2026-04-16T12:00:00Z",
  });

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "astral-sh/uv");
  assert.equal(result.selection.selected.lane, "issue-supervisor");
  assert.equal(result.selection.selected.issue_number, "202");
  assert.equal(result.selection.priorities[0].subject_locator, "astral-sh/uv#pr/101");
  assert.match(result.selection.priorities[0].veto_reasons.join(","), /open_operator_memory_pr/);
  assert.equal(result.selection.priorities[0].within_v1_scope, true);
});
