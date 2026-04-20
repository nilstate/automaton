import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  buildSelectorTrainingRow,
  buildDispatchPlan,
  discoverOpportunities,
  loadSelectionPolicy,
  runAsterCycle,
  scoreOpportunities,
  selectOpportunity,
} from "./aster-cycle.mjs";

const baseSelectionPolicy = {
  title: "Aster Selection Policy",
  version: 1,
  updated: "2026-04-17",
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
    severe: 2160,
    failed: 24,
  },
  selection_contract: {
    preferred_default: "no_op",
    max_priority_queue: 3,
    dispatch_count_per_cycle: 1,
    portfolio_budget: {
      window_cycles: 10,
      thesis_work: 0.7,
      context_improvement: 0.2,
      runtime_proof_work: 0.1,
    },
  },
};

async function writeSelectionPolicy(filePath, overrides = {}) {
  const policy = {
    ...baseSelectionPolicy,
    ...overrides,
    weights: {
      ...baseSelectionPolicy.weights,
      ...(overrides.weights ?? {}),
    },
    thresholds: {
      ...baseSelectionPolicy.thresholds,
      ...(overrides.thresholds ?? {}),
    },
    cooldown_hours: {
      ...baseSelectionPolicy.cooldown_hours,
      ...(overrides.cooldown_hours ?? {}),
    },
    selection_contract: {
      ...baseSelectionPolicy.selection_contract,
      ...(overrides.selection_contract ?? {}),
    },
  };
  await writeFile(filePath, `${JSON.stringify(policy, null, 2)}\n`);
}

test("loadSelectionPolicy parses weights, thresholds, and cooldowns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-scoring-"));
  const selectionPolicyPath = path.join(tempRoot, "selection-policy.json");
  await writeSelectionPolicy(selectionPolicyPath);

  const policy = await loadSelectionPolicy(selectionPolicyPath);

  assert.equal(policy.weights.stranger_value, 0.24);
  assert.equal(policy.thresholds.stranger_value_min, 0.6);
  assert.equal(policy.thresholds.minimum_select_score, 0.68);
  assert.equal(policy.cooldown_hours.success, 72);
  assert.equal(policy.cooldown_hours.ignored, 168);
  assert.equal(policy.selection_contract.portfolio_budget.window_cycles, 10);
  assert.equal(policy.selection_contract.portfolio_budget.context_improvement, 0.2);
});

test("selectOpportunity applies the published tie-break order", () => {
  const policy = structuredClone(baseSelectionPolicy);
  const selectedByProof = selectOpportunity({
    scored: [
      {
        id: "a",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.48,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.82, tractability: 0.7 },
      },
      {
        id: "b",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.48,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.7 },
      },
    ],
    policy,
  });
  assert.equal(selectedByProof.selected?.id, "b");

  const selectedByAuthority = selectOpportunity({
    scored: [
      {
        id: "a",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.52,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.7 },
      },
      {
        id: "b",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.31,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.7 },
      },
    ],
    policy,
  });
  assert.equal(selectedByAuthority.selected?.id, "b");

  const selectedByTractability = selectOpportunity({
    scored: [
      {
        id: "a",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.31,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.64 },
      },
      {
        id: "b",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.31,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.79 },
      },
    ],
    policy,
  });
  assert.equal(selectedByTractability.selected?.id, "b");

  const selectedByEvidence = selectOpportunity({
    scored: [
      {
        id: "a",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.31,
        evidence_at: "2026-04-15T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.79 },
      },
      {
        id: "b",
        score: 0.81,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.31,
        evidence_at: "2026-04-16T00:00:00Z",
        metrics: { proof_strength: 0.91, tractability: 0.79 },
      },
    ],
    policy,
  });
  assert.equal(selectedByEvidence.selected?.id, "b");
});

test("selectOpportunity enforces the portfolio budget before final ranking", () => {
  const policy = structuredClone(baseSelectionPolicy);
  const persistedControl = {
    targets: [],
    opportunities: [],
    priorities: [],
    reflection_entries: [],
    cycle_records: [
      { cycle_id: "1", selected_priority_id: "p1", priority_ids: ["p1"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 0, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 1, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-10T00:00:00Z" },
      { cycle_id: "2", selected_priority_id: "p2", priority_ids: ["p2"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 1, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 2, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-11T00:00:00Z" },
      { cycle_id: "3", selected_priority_id: "p3", priority_ids: ["p3"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 2, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 3, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-12T00:00:00Z" },
      { cycle_id: "4", selected_priority_id: "p4", priority_ids: ["p4"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 3, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 4, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-13T00:00:00Z" },
      { cycle_id: "5", selected_priority_id: "p5", priority_ids: ["p5"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 4, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 5, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-14T00:00:00Z" },
      { cycle_id: "6", selected_priority_id: "p6", priority_ids: ["p6"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 5, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 6, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-15T00:00:00Z" },
      { cycle_id: "7", selected_priority_id: "p7", priority_ids: ["p7"], status: "selected", reason: "ok", selected_bucket: "thesis_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 6, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 7, context_improvement: 0, runtime_proof_work: 0 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-16T00:00:00Z" },
      { cycle_id: "8", selected_priority_id: "p8", priority_ids: ["p8"], status: "selected", reason: "ok", selected_bucket: "runtime_proof_work", budget_snapshot: { window_size: 10, current_counts: { thesis_work: 7, context_improvement: 0, runtime_proof_work: 0 }, projected_counts: { thesis_work: 7, context_improvement: 0, runtime_proof_work: 1 }, target_mix: { thesis_work: 0.7, context_improvement: 0.2, runtime_proof_work: 0.1 } }, generated_at: "2026-04-17T00:00:00Z" },
    ],
  };

  const selection = selectOpportunity({
    policy,
    persistedControl,
    scored: [
      {
        id: "high-score-thesis",
        score: 0.91,
        vetoed: false,
        budget_bucket: "thesis_work",
        authority_cost: 0.4,
        evidence_at: "2026-04-18T00:00:00Z",
        metrics: { proof_strength: 0.93, tractability: 0.8 },
      },
      {
        id: "needed-context",
        score: 0.84,
        vetoed: false,
        budget_bucket: "context_improvement",
        authority_cost: 0.25,
        evidence_at: "2026-04-18T00:00:00Z",
        metrics: { proof_strength: 0.88, tractability: 0.78 },
      },
    ],
  });

  assert.equal(selection.status, "selected");
  assert.equal(selection.reason, "selected_after_portfolio_budget");
  assert.equal(selection.selected?.id, "needed-context");
  assert.equal(selection.budget_state.projected_counts.context_improvement, 1);
});

test("discover, score, and select curated prerelease targets inside nilstate scope", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-cycle-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-aster.md"),
    [
      "---",
      "title: Target Dossier — nilstate/aster",
      "subject_locator: nilstate/aster",
      "---",
      "",
      "# nilstate/aster",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "- `proving-ground`",
      "",
      "## Recent Outcomes",
      "",
      "- 2026-04-16 · `proving-ground` · `completed` · recent proving-ground run",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/aster": {
          issues: [],
          prs: [],
        },
        "nilstate/runx": {
          issues: [],
          prs: [
            {
              number: 101,
              title: "docs: fix broken app router example",
              body: "Small fix with public impact.",
              url: "https://github.com/nilstate/runx/pull/101",
              isDraft: false,
              authorAssociation: "CONTRIBUTOR",
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

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "nilstate/runx");
  assert.equal(result.selection.selected.lane, "issue-triage");
  assert.match(result.selection.priorities[0].subject_locator, /nilstate\/runx#pr\/101/);
  assert.equal(result.selection.priorities[0].within_v1_scope, true);
  assert.equal(result.selection.priorities[0].vetoed, false);
  assert.equal(result.aster_control.targets.length >= 2, true);
  assert.equal(result.aster_control.opportunities[0].opportunity_id, result.opportunities[0].id);
  assert.equal(result.aster_control.cycle_records[0].status, "selected");
  assert.equal(result.aster_control.priorities[0].status, "selected");
  assert.equal(result.aster_control.cycle_records[0].authority.scope, "public_triage");
  assert.equal(result.aster_control.cycle_records[0].dispatch.status, "ready");
  assert.equal(result.aster_control.cycle_records[0].dispatch.target_repo, "nilstate/runx");
  assert.equal(
    result.aster_control.targets.find((entry) => entry.repo === "nilstate/runx")?.lifecycle.selected_count,
    1,
  );
  assert.equal(
    result.aster_control.targets.find((entry) => entry.repo === "nilstate/runx")?.lifecycle.evaluated_count,
    1,
  );
});

test("runAsterCycle persists durable priority and cycle objects", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-persisted-control-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));
  await writeFile(path.join(repoRoot, "state", "aster-control.json"), `${JSON.stringify({
    targets: [],
    opportunities: [],
    priorities: [],
    reflection_entries: [],
    cycle_records: [],
  }, null, 2)}\n`);

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 42,
              title: "docs: repair stale hosted example",
              body: "Bounded public issue.",
              url: "https://github.com/nilstate/runx/issues/42",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-17T00:00:00Z",
            },
          ],
          prs: [],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-18T12:00:00Z",
  });
  const persisted = JSON.parse(await readFile(path.join(repoRoot, "state", "aster-control.json"), "utf8"));

  assert.equal(result.selection.status, "selected");
  assert.equal(persisted.priorities.length >= 1, true);
  assert.equal(persisted.cycle_records.length, 1);
  assert.equal(persisted.cycle_records[0].selected_priority_id, persisted.priorities[0].priority_id);
  assert.equal(persisted.cycle_records[0].priority_ids[0], persisted.priorities[0].priority_id);
  assert.equal(persisted.cycle_records[0].selected_bucket, "thesis_work");
  assert.equal(persisted.cycle_records[0].authority.approval_mode, "workflow_gate");
  assert.equal(persisted.cycle_records[0].dispatch.status, "ready");
  assert.equal(
    persisted.targets.find((entry) => entry.repo === "nilstate/runx")?.lifecycle.last_selected_at,
    "2026-04-18T12:00:00.000Z",
  );
  assert.equal(
    persisted.targets.find((entry) => entry.repo === "nilstate/runx")?.lifecycle.dispatched_count,
    0,
  );
});

test("buildSelectorTrainingRow projects a schema-valid labeled selector row", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-selector-training-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));
  await writeFile(path.join(repoRoot, "state", "aster-control.json"), `${JSON.stringify({
    targets: [],
    opportunities: [],
    priorities: [],
    reflection_entries: [],
    cycle_records: [],
  }, null, 2)}\n`);

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 42,
              title: "docs: repair stale hosted example",
              body: "Bounded public issue.",
              url: "https://github.com/nilstate/runx/issues/42",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-17T00:00:00Z",
            },
          ],
          prs: [],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-18T12:00:00Z",
  });
  const trainingRow = buildSelectorTrainingRow(result);

  assert.equal(trainingRow.kind, "runx.aster-selector-training-row.v1");
  assert.equal(trainingRow.cycle_id, result.cycle_id);
  assert.equal(trainingRow.selection_status, "selected");
  assert.equal(trainingRow.selected_bucket, "thesis_work");
  assert.equal(trainingRow.selected_opportunity_id, result.selection.selected?.id ?? null);
  assert.equal(trainingRow.priority_queue.length >= 1, true);
  assert.equal(trainingRow.candidates[0].target_repo, "nilstate/runx");
  assert.equal(trainingRow.candidates[0].vetoed, false);
  assert.equal(trainingRow.candidates[0].authority.scope, "public_triage");
  assert.equal(trainingRow.authority.approval_mode, "workflow_gate");
  assert.equal(trainingRow.dispatch.status, "ready");
});

test("runAsterCycle vetoes curated external targets outside prerelease v1 scope", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-external-veto-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

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
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "vercel/next.js": {
          issues: [],
          prs: [
            {
              number: 101,
              title: "docs: fix broken app router example",
              body: "Small fix with public impact.",
              url: "https://github.com/vercel/next.js/pull/101",
              isDraft: false,
              authorAssociation: "CONTRIBUTOR",
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

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const blockedPr = result.opportunities.find((entry) => entry.subject_locator === "vercel/next.js#pr/101");

  assert.equal(blockedPr?.within_v1_scope, false);
  assert.match(blockedPr?.veto_reasons.join(",") ?? "", /target_outside_prerelease_v1_scope/);
  assert.notEqual(result.selection.selected?.target_repo, "vercel/next.js");
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
      id: "maintenance-proving-ground",
      lane: "proving-ground",
      source: "maintenance",
      title: "Run proving-ground",
      summary: "Run proving-ground",
      subject_locator: "nilstate/aster",
      target_repo: "nilstate/aster",
      stale_days: 0.2,
      dossier: {
        default_lanes: ["proving-ground"],
        recent_outcomes: [
          {
            date: "2026-04-16",
            lane: "proving-ground",
            status: "completed",
            summary: "recent proving-ground run",
          },
        ],
      },
      memory_records: [],
    },
  ];

  const scored = scoreOpportunities({
    opportunities,
    dossiers: {
      "nilstate-aster": opportunities[0].dossier,
    },
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });

  assert.equal(scored[0].vetoed, true);
  assert.match(scored[0].veto_reasons.join(","), /cooldown/);
});

test("scoreOpportunities uses dossier current opportunities to boost lane fit", () => {
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

  const baseOpportunity = {
    lane: "issue-triage",
    source: "github_issue",
    title: "docs: clarify command",
    summary: "docs: clarify command",
    subject_locator: "nilstate/aster#issue/10",
    target_repo: "nilstate/aster",
    is_external: true,
    body_length: 80,
    stale_days: 5,
    age_days: 5,
    memory_records: [],
  };

  const [withOpportunity] = scoreOpportunities({
    opportunities: [
      {
        ...baseOpportunity,
        id: "with-opportunity",
        dossier: {
          default_lanes: ["issue-triage"],
          current_opportunities: [
            {
              lane: "issue-triage",
              summary: "Keep intake bounded and high-signal.",
            },
          ],
          recent_outcomes: [],
        },
      },
    ],
    dossiers: {},
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });
  const [withoutOpportunity] = scoreOpportunities({
    opportunities: [
      {
        ...baseOpportunity,
        id: "without-opportunity",
        dossier: {
          default_lanes: ["issue-triage"],
          current_opportunities: [],
          recent_outcomes: [],
        },
      },
    ],
    dossiers: {},
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });

  assert.ok(withOpportunity.metrics.compounding_value > withoutOpportunity.metrics.compounding_value);
  assert.ok(withOpportunity.score > withoutOpportunity.score);
});

test("buildDispatchPlan dispatches curated prerelease opportunities", () => {
  const plan = buildDispatchPlan({
    repo: "nilstate/aster",
    dispatchRef: "main",
    selection: {
      status: "selected",
      reason: "highest_non_vetoed_score",
      priorities: [],
      selected: {
        lane: "issue-triage",
        target_repo: "nilstate/runx",
        subject_locator: "nilstate/runx#pr/101",
        pr_number: "101",
        score: 0.81,
        within_v1_scope: true,
      },
    },
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.lane, "issue-triage");
  assert.equal(plan.workflow, "issue-triage.yml");
  assert.equal(plan.inputs.target_repo, "nilstate/runx");
  assert.equal(plan.inputs.pr_number, "101");
});

test("runAsterCycle prefers a bounded issue over an otherwise eligible PR", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-open-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/nilstate/runx/issues/202",
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
              url: "https://github.com/nilstate/runx/pull/101",
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

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#pr/101");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "nilstate/runx");
  assert.equal(result.selection.selected.lane, "issue-triage");
  assert.equal(result.selection.selected.issue_number, "202");
  assert.equal(vetoedPr?.subject_locator, "nilstate/runx#pr/101");
  assert.deepEqual(vetoedPr?.veto_reasons ?? [], ["comment_without_welcome_signal"]);
  assert.equal(vetoedPr?.within_v1_scope, true);
});

test("runAsterCycle vetoes bot-authored dependency update pull requests", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-bot-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/nilstate/runx/issues/202",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T10:00:00Z",
            },
          ],
          prs: [
            {
              number: 18991,
              title: "Update Rust crate similar to v3",
              body: "Renovate artifact drift.",
              url: "https://github.com/nilstate/runx/pull/18991",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "app/renovate" },
              updatedAt: "2026-04-15T12:00:00Z",
              headRefName: "renovate/similar-3.x",
              labels: ["internal", "build:artifacts"],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#pr/18991");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.subject_locator, "nilstate/runx#issue/202");
  assert.equal(vetoedPr?.subject_locator, "nilstate/runx#pr/18991");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /bot_authored_pull_request/);
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /dependency_update_pull_request/);
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /internal_or_build_only_pull_request/);
});

test("runAsterCycle vetoes PR comment candidates without a welcome signal", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-no-welcome-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 12,
              title: "docs: clarify parser behavior",
              body: "Bounded issue.",
              url: "https://github.com/nilstate/runx/issues/12",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T10:00:00Z",
            },
          ],
          prs: [
            {
              number: 101,
              title: "docs: small parser clarification",
              body: "First-time contributor PR without existing discussion.",
              url: "https://github.com/nilstate/runx/pull/101",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "first-timer" },
              updatedAt: "2026-04-15T12:00:00Z",
              headRefName: "docs/parser-clarification",
              labels: ["documentation"],
              comments: 0,
              reviewComments: 0,
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#pr/101");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.subject_locator, "nilstate/runx#issue/12");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /comment_without_welcome_signal/);
});

test("runAsterCycle enforces severe cooldown after a spam outcome", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-severe-cooldown-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
      "## Recent Outcomes",
      "",
      "- 2026-04-16 · `issue-triage` · `spam` · public comment was minimized as spam.",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/nilstate/runx/issues/202",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-16T10:00:00Z",
            },
          ],
          prs: [],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runAsterCycle({
    repoRoot,
    repo: "nilstate/aster",
    discoveryInput: discoveryPath,
    now: "2026-04-17T12:00:00Z",
  });
  const blockedIssue = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#issue/202");

  assert.ok(result.selection.status === "no_op" || result.selection.selected?.lane !== "issue-triage");
  assert.match(blockedIssue?.veto_reasons.join(",") ?? "", /cooldown:severe_/);
  assert.match(blockedIssue?.veto_reasons.join(",") ?? "", /comment_lane_in_trust_recovery/);
});
