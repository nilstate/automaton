import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { slugifyRepoLike } from "./build-aster-context.mjs";
import { isPrereleaseEligibleTargetRepo } from "./aster-v1-contracts.mjs";
import { evaluatePublicCommentOpportunity } from "./public-work-policy.mjs";
import { assertMatchesRunxControlSchema } from "./runx-control-schemas.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");
const defaultControlStateRelativePath = path.join("state", "aster-control.json");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runAsterCycle(options);
  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  }
  if (options.summaryOutput) {
    await writeFile(path.resolve(options.summaryOutput), `${renderCycleSummary(result)}\n`);
  }
  if (options.trainingOutput) {
    await writeFile(
      path.resolve(options.trainingOutput),
      `${JSON.stringify(buildSelectorTrainingRow(result), null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runAsterCycle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const repo = options.repo ?? "nilstate/aster";
  const now = options.now ? new Date(options.now) : new Date();
  const controlStatePath = path.join(repoRoot, defaultControlStateRelativePath);
  const policy = await loadSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));
  const persistedControl = await loadPersistedAsterControl(controlStatePath, repoRoot);
  const dossiers = await loadTargetDossiers(path.join(repoRoot, "state", "targets"));
  const targetRepos = unique([
    repo,
    ...Object.values(dossiers)
      .map((entry) => entry.subject_locator)
      .filter(isRepoLocator)
      .filter(isPrereleaseEligibleTargetRepo),
  ]);
  const memory = await loadOperatorMemory(repoRoot);
  const discovery = options.discoveryInput
    ? JSON.parse(await readFile(path.resolve(options.discoveryInput), "utf8"))
    : await fetchGitHubDiscovery(targetRepos, {
        maxIssues: Number(options.maxIssues ?? 20),
        maxPrs: Number(options.maxPrs ?? 20),
      });

  const opportunities = discoverOpportunities({
    repo,
    discovery,
    dossiers,
    memory,
    now,
  });
  const scored = scoreOpportunities({
    repo,
    opportunities,
    dossiers,
    memory,
    policy,
    now,
  });
  const selection = selectOpportunity({
    scored,
    policy,
    persistedControl,
  });
  const generatedAt = now.toISOString();
  const cycleId = cycleIdForGeneratedAt(generatedAt);
  const dispatchPlan = buildDispatchPlan({
    repo,
    selection,
    dispatchRef: options.dispatchRef ?? "main",
  });
  const preDispatchControl = buildAsterControlState({
    repo,
    dossiers,
    memory,
    scored,
    selection,
    dispatch: dispatchPlan,
    generatedAt,
    cycleId,
    previousControl: persistedControl,
  });
  if (options.persistState !== false) {
    await writeAsterControlState(controlStatePath, preDispatchControl);
  }
  const dispatchResult = options.dispatch
    ? dispatchLane(dispatchPlan)
    : dispatchPlan;
  const asterControl = dispatchResult.status === dispatchPlan.status
    ? preDispatchControl
    : buildAsterControlState({
        repo,
        dossiers,
        memory,
        scored,
        selection,
        dispatch: dispatchResult,
        generatedAt,
        cycleId,
        previousControl: persistedControl,
      });
  if (options.persistState !== false && dispatchResult.status !== dispatchPlan.status) {
    await writeAsterControlState(controlStatePath, asterControl);
  }

  return {
    generated_at: generatedAt,
    cycle_id: cycleId,
    repo,
    policy,
    opportunity_count: scored.length,
    opportunities: scored,
    selection,
    dispatch: dispatchResult,
    aster_control: asterControl,
  };
}

export async function loadSelectionPolicy(filePath) {
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  return {
    title: String(raw.title ?? "Aster Selection Policy"),
    version: Number(raw.version ?? 1),
    updated: String(raw.updated ?? ""),
    weights: {
      stranger_value: Number(raw.weights?.stranger_value ?? 0.24),
      proof_strength: Number(raw.weights?.proof_strength ?? 0.24),
      compounding_value: Number(raw.weights?.compounding_value ?? 0.19),
      tractability: Number(raw.weights?.tractability ?? 0.16),
      novelty: Number(raw.weights?.novelty ?? 0.09),
      maintenance_efficiency: Number(raw.weights?.maintenance_efficiency ?? 0.08),
    },
    thresholds: {
      stranger_value_min: Number(raw.thresholds?.stranger_value_min ?? 0.6),
      proof_strength_min: Number(raw.thresholds?.proof_strength_min ?? 0.7),
      minimum_select_score: Number(raw.thresholds?.minimum_select_score ?? 0.68),
    },
    cooldown_hours: {
      success: Number(raw.cooldown_hours?.success ?? 72),
      ignored: Number(raw.cooldown_hours?.ignored ?? 24 * 7),
      rejected: Number(raw.cooldown_hours?.rejected ?? 24 * 21),
      severe: Number(raw.cooldown_hours?.severe ?? 24 * 90),
      failed: Number(raw.cooldown_hours?.failed ?? 24),
    },
    selection_contract: {
      preferred_default: String(raw.selection_contract?.preferred_default ?? "no_op"),
      max_priority_queue: Number(raw.selection_contract?.max_priority_queue ?? 3),
      dispatch_count_per_cycle: Number(raw.selection_contract?.dispatch_count_per_cycle ?? 1),
      portfolio_budget: {
        window_cycles: Number(raw.selection_contract?.portfolio_budget?.window_cycles ?? 10),
        thesis_work: Number(raw.selection_contract?.portfolio_budget?.thesis_work ?? 0.7),
        context_improvement: Number(raw.selection_contract?.portfolio_budget?.context_improvement ?? 0.2),
        runtime_proof_work: Number(raw.selection_contract?.portfolio_budget?.runtime_proof_work ?? 0.1),
      },
    },
    public_comment_policy: raw.public_comment_policy ?? {},
  };
}

export const loadScoringPolicy = loadSelectionPolicy;

export function discoverOpportunities({ repo, discovery, dossiers, memory, now }) {
  const opportunities = [];

  for (const [targetRepo, targetDiscovery] of Object.entries(normalizeDiscovery(discovery, repo))) {
    const issues = normalizeCollection(targetDiscovery.issues);
    const prs = normalizeCollection(targetDiscovery.prs);
    const dossier = dossiers[slugifyRepoLike(targetRepo)] ?? null;

    for (const issue of issues) {
      const lane = String(issue.title ?? "").startsWith("[skill]") && targetRepo === repo
        ? "skill-lab"
        : "issue-triage";
      const updatedAt = issue.updatedAt ?? issue.updated_at ?? issue.createdAt ?? issue.created_at ?? now.toISOString();
      opportunities.push({
        id: `issue-${targetRepo}-${issue.number}-${lane}`,
        lane,
        source: "github_issue",
        title: issue.title ?? `Issue #${issue.number}`,
        summary: issue.title ?? `Issue #${issue.number}`,
        subject_kind: "github_issue",
        subject_locator: `${targetRepo}#issue/${issue.number}`,
        target_repo: targetRepo,
        issue_number: String(issue.number),
        issue_url: issue.url ?? null,
        author_association: firstString(issue.authorAssociation ?? issue.author_association),
        author_login: firstString(issue.author?.login ?? issue.author_login),
        is_external: !isInternalAssociation(issue.authorAssociation ?? issue.author_association),
        body_length: String(issue.body ?? "").length,
        updated_at: updatedAt,
        age_days: ageDays(now, updatedAt),
        stale_days: ageDays(now, updatedAt),
        dossier,
        memory_records: findRelevantMemory(memory, `${targetRepo}#issue/${issue.number}`, targetRepo, lane),
      });
    }

    for (const pr of prs) {
      const updatedAt = pr.updatedAt ?? pr.updated_at ?? pr.createdAt ?? pr.created_at ?? now.toISOString();
      opportunities.push({
        id: `pr-${targetRepo}-${pr.number}-issue-triage`,
        lane: "issue-triage",
        source: "github_pull_request",
        title: pr.title ?? `PR #${pr.number}`,
        summary: pr.title ?? `PR #${pr.number}`,
        subject_kind: "github_pull_request",
        subject_locator: `${targetRepo}#pr/${pr.number}`,
        target_repo: targetRepo,
        pr_number: String(pr.number),
        pr_url: pr.url ?? null,
        author_association: firstString(pr.authorAssociation ?? pr.author_association),
        author_login: firstString(pr.author?.login ?? pr.author_login),
        is_external: !isInternalAssociation(pr.authorAssociation ?? pr.author_association),
        body_length: String(pr.body ?? "").length,
        labels: normalizeCollection(pr.labels),
        comments_count: Number(pr.comments ?? pr.comments_count ?? 0),
        review_comments_count: Number(pr.reviewComments ?? pr.review_comments_count ?? 0),
        updated_at: updatedAt,
        age_days: ageDays(now, updatedAt),
        stale_days: ageDays(now, updatedAt),
        is_draft: Boolean(pr.isDraft ?? pr.is_draft),
        head_ref_name: firstString(pr.headRefName ?? pr.head_ref_name),
        dossier,
        memory_records: findRelevantMemory(memory, `${targetRepo}#pr/${pr.number}`, targetRepo, "issue-triage"),
      });
    }
  }

  opportunities.push(
    buildMaintenanceOpportunity({
      lane: "proving-ground",
      repo,
      dossiers,
      memory,
      now,
      title: "Run bounded proving-ground lanes to surface receipt and governance drift",
    }),
  );

  return opportunities;
}

export function scoreOpportunities({
  repo = "nilstate/aster",
  opportunities,
  dossiers,
  memory,
  policy,
  now,
}) {
  return opportunities
    .map((opportunity) => scoreOpportunity({
      repo,
      opportunity,
      dossiers,
      memory,
      policy,
      now,
    }))
    .sort(compareSelectionCandidates);
}

export function scoreOpportunity({
  repo = "nilstate/aster",
  opportunity,
  dossiers,
  memory,
  policy,
  now,
}) {
  const dossier = opportunity.dossier ?? dossiers[slugifyRepoLike(opportunity.target_repo)] ?? null;
  const allowedLanes = dossier?.default_lanes ?? [];
  const recentOutcomes = dossier?.recent_outcomes ?? [];
  const memoryRecords = opportunity.memory_records ?? findRelevantMemory(
    memory,
    opportunity.subject_locator,
    opportunity.target_repo,
    opportunity.lane,
  );

  const metrics = {
    stranger_value: computeStrangerValue(opportunity),
    proof_strength: computeProofStrength(opportunity),
    compounding_value: computeCompoundingValue(opportunity, dossier),
    tractability: computeTractability(opportunity),
    novelty: computeNovelty(
      opportunity,
      recentOutcomes,
      memoryRecords,
      countRecentLaneExecutions(memory, opportunity.lane),
    ),
    maintenance_efficiency: computeMaintenanceEfficiency(opportunity),
  };
  const budgetBucket = budgetBucketForOpportunity(opportunity);
  const authorityCost = computeAuthorityCost(opportunity);
  const evidenceAt = normalizeEvidenceAt(opportunity.updated_at, now.toISOString());

  const cooldown = computeCooldown({
    lane: opportunity.lane,
    recentOutcomes,
    now,
    policy,
  });
  const lane_allowed = allowedLanes.length === 0 || allowedLanes.includes(opportunity.lane);
  const within_v1_scope = isPrereleaseEligibleTargetRepo(opportunity.target_repo)
    && (dossier !== null || opportunity.target_repo === repo);
  const veto_reasons = [];
  if (!within_v1_scope) {
    veto_reasons.push("target_outside_prerelease_v1_scope");
  }
  if (!lane_allowed) {
    veto_reasons.push("lane_not_allowed_by_target");
  }
  if (String(opportunity.head_ref_name ?? "").startsWith("runx/operator-memory-")) {
    veto_reasons.push("subject_is_operator_memory_pr");
  }
  if (opportunity.lane === "issue-triage") {
    const publicCommentPolicy = evaluatePublicCommentOpportunity({
      source: opportunity.source,
      lane: opportunity.lane,
      authorLogin: opportunity.author_login,
      authorAssociation: opportunity.author_association,
      title: opportunity.title,
      labels: opportunity.labels,
      headRefName: opportunity.head_ref_name,
      commentsCount: opportunity.comments_count,
      reviewCommentsCount: opportunity.review_comments_count,
      recentOutcomes,
    });
    veto_reasons.push(...publicCommentPolicy.reasons);
  }
  if (cooldown.active) {
    veto_reasons.push(`cooldown:${cooldown.reason}`);
  }
  if (metrics.stranger_value < policy.thresholds.stranger_value_min) {
    veto_reasons.push("stranger_value_below_floor");
  }
  if (metrics.proof_strength < policy.thresholds.proof_strength_min) {
    veto_reasons.push("proof_strength_below_floor");
  }

  const score = roundScore(Object.entries(policy.weights).reduce((total, [key, weight]) => {
    return total + weight * (metrics[key] ?? 0);
  }, 0));

  return {
    ...opportunity,
    budget_bucket: budgetBucket,
    authority_cost: authorityCost,
    evidence_at: evidenceAt,
    lane_allowed,
    within_v1_scope,
    metrics,
    score,
    cooldown,
    veto_reasons,
    vetoed: veto_reasons.length > 0,
  };
}

export function selectOpportunity({ scored, policy, persistedControl = emptyAsterControlState() }) {
  const thresholdEligible = scored.filter((entry) => {
    return !entry.vetoed && entry.score >= policy.thresholds.minimum_select_score;
  });
  const budgetState = buildPortfolioBudgetState(policy, persistedControl);

  if (thresholdEligible.length === 0) {
    return {
      status: "no_op",
      reason: scored.some((entry) => !entry.vetoed)
        ? "top_candidate_below_selection_threshold"
        : "all_candidates_vetoed",
      priorities: buildPriorityQueue({
        scored,
        maxPriorityQueue: policy.selection_contract?.max_priority_queue ?? 3,
      }),
      selected: null,
      budget_state: projectBudgetState({
        budgetState,
        selectedBucket: null,
      }),
    };
  }

  const budgetEligible = filterBudgetEligibleCandidates(thresholdEligible, budgetState);
  if (budgetEligible.length === 0) {
    return {
      status: "no_op",
      reason: policy.selection_contract?.preferred_default ?? "no_op",
      priorities: buildPriorityQueue({
        scored,
        maxPriorityQueue: policy.selection_contract?.max_priority_queue ?? 3,
      }),
      selected: null,
      budget_state: projectBudgetState({
        budgetState,
        selectedBucket: null,
      }),
    };
  }
  const [top] = budgetEligible;
  const priorities = buildPriorityQueue({
    scored,
    selected: top,
    maxPriorityQueue: policy.selection_contract?.max_priority_queue ?? 3,
  });

  return {
    status: "selected",
    reason: budgetEligible.length === thresholdEligible.length
      ? "highest_non_vetoed_score"
      : "selected_after_portfolio_budget",
    priorities,
    selected: top,
    budget_state: projectBudgetState({
      budgetState,
      selectedBucket: top.budget_bucket,
    }),
  };
}

export function buildDispatchPlan({ repo, selection, dispatchRef }) {
  if (selection.status !== "selected" || !selection.selected) {
    return {
      status: "no_dispatch",
      reason: selection.reason,
    };
  }

  const candidate = selection.selected;
  if (candidate.within_v1_scope !== true) {
    return {
      status: "no_dispatch",
      reason: "target_outside_prerelease_v1_scope",
      lane: candidate.lane,
    };
  }
  const workflow = laneWorkflow(candidate.lane);
  if (!workflow) {
    return {
      status: "no_dispatch",
      reason: "lane_has_no_dispatchable_workflow",
      lane: candidate.lane,
    };
  }

  const inputs = {};
  if (candidate.target_repo && candidate.target_repo !== repo) {
    inputs.target_repo = candidate.target_repo;
  }
  if (candidate.issue_number) {
    inputs.issue_number = String(candidate.issue_number);
  }
  if (candidate.pr_number) {
    inputs.pr_number = String(candidate.pr_number);
  }

  return {
    status: "ready",
    lane: candidate.lane,
    workflow,
    repo,
    ref: dispatchRef,
    target_repo: candidate.target_repo ?? null,
    inputs,
    subject_locator: candidate.subject_locator,
    score: candidate.score,
  };
}

export function dispatchLane(plan, runner = run) {
  if (plan.status !== "ready") {
    return plan;
  }

  const args = [
    "workflow",
    "run",
    plan.workflow,
    "--repo",
    plan.repo ?? "nilstate/aster",
    "--ref",
    plan.ref,
  ];
  for (const [key, value] of Object.entries(plan.inputs ?? {})) {
    args.push("-f", `${key}=${value}`);
  }
  const output = runner("gh", args).trim();
  return {
    ...plan,
    status: "dispatched",
    output,
  };
}

export function renderCycleSummary(result) {
  const lines = [
    "# Aster Cycle",
    "",
    `- generated_at: \`${result.generated_at}\``,
    `- opportunities: \`${result.opportunity_count}\``,
    `- selection_status: \`${result.selection.status}\``,
  ];

  if (result.selection.selected) {
    lines.push(`- selected_lane: \`${result.selection.selected.lane}\``);
    lines.push(`- selected_score: \`${result.selection.selected.score}\``);
    lines.push(`- selected_subject: \`${result.selection.selected.subject_locator}\``);
  } else {
    lines.push(`- reason: \`${result.selection.reason}\``);
  }

  lines.push("", "## Priority Queue", "");
  for (const entry of result.selection.priorities ?? []) {
    const veto = entry.vetoed ? ` vetoed=${entry.veto_reasons.join(",")}` : "";
    lines.push(`- \`${entry.lane}\` · \`${entry.subject_locator}\` · score=${entry.score}${veto}`);
  }

  if (result.dispatch?.status === "dispatched") {
    lines.push("", "## Dispatch", "", `- workflow: \`${result.dispatch.workflow}\``, `- ref: \`${result.dispatch.ref}\``);
  }

  return lines.join("\n").trim();
}

export function buildAsterControlState({
  repo,
  dossiers,
  memory,
  scored,
  selection,
  dispatch,
  generatedAt,
  cycleId,
  previousControl = emptyAsterControlState(),
}) {
  const targetRepos = unique([
    repo,
    ...Object.values(dossiers ?? {})
      .map((entry) => firstString(entry?.subject_locator))
      .filter(Boolean)
      .filter(isPrereleaseEligibleTargetRepo),
    ...scored.map((entry) => firstString(entry?.target_repo)).filter(Boolean),
    ...normalizeCollection(memory?.reflections)
      .map((entry) => repoFromSubjectLocator(entry?.subject_locator) || firstString(entry?.target_repo))
      .filter(Boolean)
      .filter(isPrereleaseEligibleTargetRepo),
  ]);
  const targetIdByRepo = Object.fromEntries(
    targetRepos.map((targetRepo) => [targetRepo, slugifyRepoLike(targetRepo)]),
  );
  const previousTargetsByRepo = Object.fromEntries(
    normalizeCollection(previousControl?.targets).map((entry) => [entry?.repo, entry]),
  );
  const currentPriorities = buildPersistentPriorityRecords({
    cycleId,
    entries: selection?.priorities ?? [],
    selection,
    dispatch,
  });
  const priorityIdByOpportunityId = Object.fromEntries(
    currentPriorities.map((entry) => [entry.opportunity_id, entry.priority_id]),
  );
  const selectedPriorityId = selection?.selected
    ? priorityIdByOpportunityId[selection.selected.id] ?? null
    : null;
  const cycleStatus = dispatch?.status === "dispatched"
    ? "dispatched"
    : selection?.status === "selected"
      ? "selected"
      : "no_op";
  const cycleReason = firstString(selection?.reason)
    || firstString(dispatch?.reason)
    || (selection?.selected ? "selected_for_dispatch" : "no_op");
  const cycleAuthority = buildAuthorityForSelection(selection);
  const cycleDispatch = buildDispatchRecord({
    dispatch,
    selection,
    repo,
  });
  const currentCycleRecord = {
    cycle_id: cycleId,
    selected_priority_id: selectedPriorityId,
    priority_ids: currentPriorities.map((entry) => entry.priority_id),
    status: cycleStatus,
    reason: cycleReason,
    selected_bucket: selection?.selected?.budget_bucket ?? null,
    budget_snapshot: selection?.budget_state ?? projectBudgetState({
      budgetState: buildPortfolioBudgetState({
        selection_contract: {
          portfolio_budget: defaultPortfolioBudget(),
        },
      }, previousControl),
      selectedBucket: selection?.selected?.budget_bucket ?? null,
    }),
    authority: cycleAuthority,
    dispatch: cycleDispatch,
    generated_at: generatedAt,
  };

  const controlState = {
    targets: targetRepos.map((targetRepo) => ({
      target_id: targetIdByRepo[targetRepo],
      repo: targetRepo,
      state: resolveTargetState({
        repo,
        targetRepo,
        scored,
        selection,
      }),
      default_lanes: dossiers?.[slugifyRepoLike(targetRepo)]?.default_lanes ?? [],
      lifecycle: buildTargetLifecycle({
        previousTarget: previousTargetsByRepo[targetRepo] ?? null,
        targetRepo,
        generatedAt,
        cycleId,
        cycleStatus,
        cycleReason,
        selection,
        dispatch,
      }),
    })),
    opportunities: scored.map((entry) => ({
      opportunity_id: entry.id,
      target_id: targetIdByRepo[entry.target_repo] ?? slugifyRepoLike(entry.target_repo),
      subject_locator: entry.subject_locator,
      lane: entry.lane,
      source: entry.source,
      budget_bucket: entry.budget_bucket,
      authority_cost: entry.authority_cost,
      evidence_at: entry.evidence_at,
      thesis_score: entry.metrics,
    })),
    priorities: mergeRecentRecords(previousControl.priorities, currentPriorities, {
      idKey: "priority_id",
      maxItems: 48,
    }),
    reflection_entries: buildReflectionEntries(memory?.reflections, targetIdByRepo, generatedAt),
    cycle_records: mergeRecentRecords(previousControl.cycle_records, [currentCycleRecord], {
      idKey: "cycle_id",
      maxItems: 48,
    }),
  };

  return assertMatchesRunxControlSchema("aster_control", controlState, {
    label: "aster_control",
  });
}

export function buildSelectorTrainingRow(result) {
  const latestCycleRecord = normalizeCollection(result?.aster_control?.cycle_records).at(-1) ?? null;
  const priorities = normalizeCollection(result?.aster_control?.priorities);
  const selectedPriority = priorities.find((entry) => entry?.priority_id === latestCycleRecord?.selected_priority_id) ?? null;
  const row = {
    kind: "runx.aster-selector-training-row.v1",
    generated_at: firstString(result?.generated_at) ?? new Date().toISOString(),
    cycle_id: firstString(result?.cycle_id)
      ?? firstString(latestCycleRecord?.cycle_id)
      ?? cycleIdForGeneratedAt(firstString(result?.generated_at) ?? new Date().toISOString()),
    repo: firstString(result?.repo) ?? "nilstate/aster",
    policy_version: Number(result?.policy?.version ?? 1),
    minimum_select_score: Number(result?.policy?.thresholds?.minimum_select_score ?? 0),
    candidates: normalizeCollection(result?.opportunities).map((entry) => ({
      opportunity_id: entry.id,
      subject_locator: entry.subject_locator,
      target_repo: entry.target_repo,
      lane: entry.lane,
      source: entry.source,
      budget_bucket: entry.budget_bucket,
      authority_cost: entry.authority_cost,
      evidence_at: entry.evidence_at,
      thesis_score: entry.metrics ?? {},
      score: entry.score,
      vetoed: Boolean(entry.vetoed),
      veto_reasons: normalizeCollection(entry.veto_reasons).map(String),
      within_v1_scope: Boolean(entry.within_v1_scope),
      lane_allowed: Boolean(entry.lane_allowed),
      cooldown_active: Boolean(entry.cooldown?.active),
      cooldown_reason: entry.cooldown?.reason ?? null,
      authority: buildAuthorityForOpportunity(entry),
    })),
    priority_queue: normalizeCollection(latestCycleRecord?.priority_ids).map(String),
    selection_status: firstString(result?.selection?.status) ?? "no_op",
    selection_reason: firstString(result?.selection?.reason) ?? "no_op",
    selected_priority_id: latestCycleRecord?.selected_priority_id ?? null,
    selected_opportunity_id: result?.selection?.selected?.id ?? selectedPriority?.opportunity_id ?? null,
    selected_bucket: latestCycleRecord?.selected_bucket ?? result?.selection?.selected?.budget_bucket ?? null,
    budget_snapshot: latestCycleRecord?.budget_snapshot ?? result?.selection?.budget_state,
    authority: latestCycleRecord?.authority ?? buildAuthorityForSelection(result?.selection),
    dispatch: latestCycleRecord?.dispatch ?? buildDispatchRecord({
      dispatch: result?.dispatch,
      selection: result?.selection,
      repo: result?.repo,
    }),
  };

  return assertMatchesRunxControlSchema("selector_training_row", row, {
    label: "selector_training_row",
  });
}

async function fetchGitHubDiscovery(repos, options) {
  const discovery = {};
  for (const repo of repos) {
    const issues = JSON.parse(run("gh", [
      "api",
      `repos/${repo}/issues?state=open&per_page=${String(options.maxIssues ?? 20)}`,
      "--jq",
      "[ .[] | select(has(\"pull_request\") | not) | { number, title, body, url: .html_url, author: { login: .user.login }, authorAssociation: .author_association, createdAt: .created_at, updatedAt: .updated_at, labels: [ .labels[]?.name ] } ]",
    ]));
    const prs = JSON.parse(run("gh", [
      "api",
      `repos/${repo}/pulls?state=open&per_page=${String(options.maxPrs ?? 20)}`,
      "--jq",
      "[ .[] | { number, title, body, url: .html_url, isDraft: (.draft // false), author: { login: .user.login }, authorAssociation: .author_association, createdAt: .created_at, updatedAt: .updated_at, headRefName: .head.ref, baseRefName: .base.ref, labels: [ .labels[]?.name ], comments: (.comments // 0), reviewComments: (.review_comments // 0) } ]",
    ]));
    discovery[repo] = { issues, prs };
  }
  return discovery;
}

async function loadTargetDossiers(targetDir) {
  const dossiers = {};
  if (!existsSync(targetDir)) {
    return dossiers;
  }

  const entries = await readdir(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(targetDir, entry.name);
    const raw = await readFile(filePath, "utf8");
    const { frontmatter, content } = splitFrontmatter(raw);
    const locator = firstString(frontmatter.subject_locator) || path.basename(entry.name, ".md");
    dossiers[slugifyRepoLike(locator)] = {
      path: filePath,
      subject_locator: locator,
      default_lanes: parseSectionCodeList(content, "Default Lanes"),
      current_opportunities: parseCurrentOpportunities(content),
      recent_outcomes: parseRecentOutcomes(content),
      trust_notes: parseSectionBullets(content, "Trust Notes"),
    };
  }

  return dossiers;
}

async function loadOperatorMemory(repoRoot) {
  const threadTeachingState = await readOptionalJson(path.join(repoRoot, "state", "thread-teaching.json"));
  return {
    history: await loadMarkdownMemory(path.join(repoRoot, "history"), repoRoot),
    reflections: await loadMarkdownMemory(path.join(repoRoot, "reflections"), repoRoot),
    thread_teaching: Array.isArray(threadTeachingState?.records) ? threadTeachingState.records : [],
  };
}

async function loadMarkdownMemory(dirPath, repoRoot) {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = (await readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const docs = [];
  for (const name of entries) {
    const filePath = path.join(dirPath, name);
    const raw = await readFile(filePath, "utf8");
    const { frontmatter, content } = splitFrontmatter(raw);
    docs.push({
      path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      title: firstString(frontmatter.title) || path.basename(name, ".md"),
      lane: firstString(frontmatter.lane),
      date: firstString(frontmatter.date),
      target_repo: firstString(frontmatter.target_repo),
      subject_locator: firstString(frontmatter.subject_locator),
      excerpt: stripMarkdown(content).slice(0, 280),
      content,
      frontmatter,
    });
  }
  return docs;
}

async function readOptionalJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function buildMaintenanceOpportunity({ lane, repo, dossiers, memory, now, title }) {
  const target = dossiers[slugifyRepoLike(repo)] ?? null;
  const lastSeen = findLatestLaneDate(memory, lane);
  return {
    id: `maintenance-${lane}`,
    lane,
    source: "maintenance",
    title,
    summary: title,
    subject_kind: "github_repository",
    subject_locator: repo,
    target_repo: repo,
    stale_days: lastSeen ? ageDays(now, lastSeen) : 30,
    age_days: lastSeen ? ageDays(now, lastSeen) : 30,
    dossier: target,
    memory_records: findRelevantMemory(memory, repo, repo, lane),
  };
}

function computeStrangerValue(opportunity) {
  if (opportunity.source === "github_issue") {
    const base = opportunity.is_external ? 0.82 : 0.58;
    return clamp(base + Math.min(opportunity.stale_days / 60, 0.08));
  }
  if (opportunity.source === "github_pull_request") {
    const base = opportunity.is_external ? 0.72 : 0.54;
    return clamp(base + Math.min(opportunity.stale_days / 45, 0.04));
  }
  if (opportunity.lane === "proving-ground") {
    return clamp(0.46 + Math.min(opportunity.stale_days / 60, 0.24));
  }
  return 0.5;
}

function computeProofStrength(opportunity) {
  if (opportunity.source === "github_pull_request") {
    return 0.88;
  }
  if (opportunity.source === "github_issue") {
    return 0.92;
  }
  if (opportunity.lane === "proving-ground") {
    return 0.74;
  }
  return 0.72;
}

function computeCompoundingValue(opportunity, dossier) {
  let score = 0.68;
  if (opportunity.target_repo === "nilstate/aster") {
    score += 0.09;
  }
  if (opportunity.target_repo === "nilstate/runx") {
    score += 0.11;
  }
  if (dossier?.default_lanes?.includes(opportunity.lane)) {
    score += 0.05;
  }
  if (dossier?.current_opportunities?.some((entry) => entry.lane === opportunity.lane)) {
    score += 0.07;
  }
  if (opportunity.lane === "issue-triage") {
    score += 0.04;
  }
  return clamp(score);
}

function computeTractability(opportunity) {
  if (opportunity.source === "github_pull_request") {
    let score = opportunity.is_draft ? 0.56 : 0.7;
    if (opportunity.body_length < 1600) {
      score += 0.04;
    }
    if (Number(opportunity.comments_count ?? 0) + Number(opportunity.review_comments_count ?? 0) > 0) {
      score += 0.04;
    }
    return clamp(score);
  }
  if (opportunity.source === "github_issue") {
    let score = opportunity.lane === "skill-lab" ? 0.63 : 0.72;
    if (opportunity.body_length < 1800) {
      score += 0.05;
    }
    return clamp(score);
  }
  if (opportunity.lane === "proving-ground") {
    return 0.9;
  }
  return 0.65;
}

function computeNovelty(opportunity, recentOutcomes, memoryRecords, recentLaneExecutions = 0) {
  const sameLaneOutcomes = recentOutcomes.filter((entry) => entry.lane === opportunity.lane);
  const sameSubjectRecords = memoryRecords.filter((entry) => entry.subject_locator === opportunity.subject_locator);
  let score = 0.82;
  score -= Math.min(sameLaneOutcomes.length, 2) * 0.14;
  score -= Math.min(sameSubjectRecords.length, 2) * 0.09;
  score -= Math.min(Math.max(recentLaneExecutions - 1, 0), 3) * 0.05;
  return clamp(score, 0.2, 1);
}

function computeMaintenanceEfficiency(opportunity) {
  if (opportunity.lane === "issue-triage") {
    if (opportunity.source === "github_pull_request") {
      return 0.58;
    }
    return 0.76;
  }
  if (opportunity.lane === "skill-lab") {
    return 0.6;
  }
  if (opportunity.lane === "proving-ground") {
    return 0.86;
  }
  return 0.6;
}

function computeCooldown({ lane, recentOutcomes, now, policy }) {
  const recent = recentOutcomes.find((entry) => entry.lane === lane);
  if (!recent?.date) {
    return { active: false, hours_remaining: 0, reason: null };
  }

  const statusGroup = mapCooldownStatus(recent.status);
  const limitHours = policy.cooldown_hours[statusGroup];
  if (!limitHours) {
    return { active: false, hours_remaining: 0, reason: null };
  }

  const elapsedHours = ageHours(now, recent.date);
  const remaining = Math.max(0, Math.ceil(limitHours - elapsedHours));
  return {
    active: remaining > 0,
    hours_remaining: remaining,
    reason: remaining > 0 ? `${statusGroup}_${remaining}h_remaining` : null,
    last_outcome: recent,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--discovery-input") {
      options.discoveryInput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--dispatch-ref") {
      options.dispatchRef = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-issues") {
      options.maxIssues = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-prs") {
      options.maxPrs = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--allow-external-targets") {
      options.allowExternalTargets = true;
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--dispatch") {
      options.dispatch = true;
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--summary-output") {
      options.summaryOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--training-output") {
      options.trainingOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--no-persist-state") {
      options.persistState = false;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function projectSelectorTrainingDispatch(dispatch) {
  if (!dispatch) {
    return { status: "no_dispatch" };
  }

  const projected = {
    status: dispatch.status,
  };
  if (dispatch.reason) {
    projected.reason = dispatch.reason;
  }
  if (dispatch.lane) {
    projected.lane = dispatch.lane;
  }
  if (dispatch.workflow) {
    projected.workflow = dispatch.workflow;
  }
  if (dispatch.ref) {
    projected.ref = dispatch.ref;
  }
  if (dispatch.subject_locator) {
    projected.subject_locator = dispatch.subject_locator;
  }
  if (typeof dispatch.score === "number") {
    projected.score = dispatch.score;
  }
  return projected;
}

function normalizeCollection(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDiscovery(discovery, repo) {
  if (Array.isArray(discovery.issues) || Array.isArray(discovery.prs)) {
    return { [repo]: discovery };
  }
  return discovery ?? {};
}

function roundScore(value) {
  return Math.round(value * 1000) / 1000;
}

function emptyAsterControlState() {
  return {
    targets: [],
    opportunities: [],
    priorities: [],
    reflection_entries: [],
    cycle_records: [],
  };
}

async function loadPersistedAsterControl(filePath, repoRoot) {
  if (!existsSync(filePath)) {
    return emptyAsterControlState();
  }
  const value = JSON.parse(await readFile(filePath, "utf8"));
  return assertMatchesRunxControlSchema("aster_control", value, {
    label: "aster_control",
  });
}

async function writeAsterControlState(filePath, controlState) {
  await writeFile(filePath, `${JSON.stringify(controlState, null, 2)}\n`);
}

function defaultPortfolioBudget() {
  return {
    window_cycles: 10,
    thesis_work: 0.7,
    context_improvement: 0.2,
    runtime_proof_work: 0.1,
  };
}

function budgetBucketForOpportunity(opportunity) {
  if (opportunity.lane === "proving-ground") {
    return "runtime_proof_work";
  }
  if (opportunity.lane === "skill-lab") {
    return "context_improvement";
  }
  return "thesis_work";
}

function computeAuthorityCost(opportunity) {
  if (opportunity.lane === "proving-ground") {
    return 0.08;
  }
  if (opportunity.lane === "skill-lab") {
    return 0.28;
  }
  if (opportunity.source === "github_pull_request") {
    return 0.56;
  }
  if (opportunity.source === "github_issue") {
    return 0.48;
  }
  return 0.32;
}

function normalizeEvidenceAt(value, fallback) {
  const candidate = firstString(value);
  if (!candidate) {
    return fallback;
  }
  return Number.isNaN(Date.parse(candidate)) ? fallback : new Date(candidate).toISOString();
}

function compareSelectionCandidates(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if ((right.metrics?.proof_strength ?? 0) !== (left.metrics?.proof_strength ?? 0)) {
    return (right.metrics?.proof_strength ?? 0) - (left.metrics?.proof_strength ?? 0);
  }
  if ((left.authority_cost ?? 1) !== (right.authority_cost ?? 1)) {
    return (left.authority_cost ?? 1) - (right.authority_cost ?? 1);
  }
  if ((right.metrics?.tractability ?? 0) !== (left.metrics?.tractability ?? 0)) {
    return (right.metrics?.tractability ?? 0) - (left.metrics?.tractability ?? 0);
  }
  return Date.parse(right.evidence_at ?? 0) - Date.parse(left.evidence_at ?? 0);
}

function buildPriorityQueue({ scored, selected = null, maxPriorityQueue = 3 }) {
  const queue = [];
  if (selected) {
    queue.push(selected);
  }
  for (const entry of scored) {
    if (selected?.id === entry.id) {
      continue;
    }
    queue.push(entry);
    if (queue.length >= maxPriorityQueue) {
      break;
    }
  }
  return queue.slice(0, maxPriorityQueue);
}

function buildPortfolioBudgetState(policy, persistedControl) {
  const configured = policy.selection_contract?.portfolio_budget ?? defaultPortfolioBudget();
  const normalized = {
    window_cycles: Math.max(1, Number(configured.window_cycles ?? 10)),
    thesis_work: Number(configured.thesis_work ?? 0.7),
    context_improvement: Number(configured.context_improvement ?? 0.2),
    runtime_proof_work: Number(configured.runtime_proof_work ?? 0.1),
  };
  const historyWindow = normalized.window_cycles > 1 ? normalized.window_cycles - 1 : 0;
  const bucketHistory = normalizeCollection(persistedControl?.cycle_records)
    .map((entry) => entry?.selected_bucket)
    .filter(Boolean);
  const history = historyWindow > 0 ? bucketHistory.slice(-historyWindow) : [];

  return {
    window_size: normalized.window_cycles,
    target_mix: {
      thesis_work: normalized.thesis_work,
      context_improvement: normalized.context_improvement,
      runtime_proof_work: normalized.runtime_proof_work,
    },
    current_counts: countBudgetBuckets(history),
  };
}

function filterBudgetEligibleCandidates(candidates, budgetState) {
  const projected = candidates.map((entry) => ({
    entry,
    error: projectedBudgetError(budgetState, entry.budget_bucket),
  }));
  const minError = Math.min(...projected.map((entry) => entry.error));
  return projected
    .filter((entry) => entry.error === minError)
    .map((entry) => entry.entry)
    .sort(compareSelectionCandidates);
}

function projectedBudgetError(budgetState, selectedBucket) {
  const projectedCounts = projectBudgetCounts(budgetState.current_counts, selectedBucket);
  const total = Object.values(projectedCounts).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return 0;
  }
  return roundScore(
    Object.entries(projectedCounts).reduce((sum, [bucket, count]) => {
      const targetShare = budgetState.target_mix[bucket] ?? 0;
      return sum + Math.abs((count / total) - targetShare);
    }, 0),
  );
}

function projectBudgetState({ budgetState, selectedBucket }) {
  return {
    window_size: budgetState.window_size,
    current_counts: budgetState.current_counts,
    projected_counts: projectBudgetCounts(budgetState.current_counts, selectedBucket),
    target_mix: budgetState.target_mix,
  };
}

function projectBudgetCounts(currentCounts, selectedBucket) {
  const projected = {
    thesis_work: Number(currentCounts?.thesis_work ?? 0),
    context_improvement: Number(currentCounts?.context_improvement ?? 0),
    runtime_proof_work: Number(currentCounts?.runtime_proof_work ?? 0),
  };
  if (selectedBucket && Object.hasOwn(projected, selectedBucket)) {
    projected[selectedBucket] += 1;
  }
  return projected;
}

function countBudgetBuckets(values) {
  const counts = {
    thesis_work: 0,
    context_improvement: 0,
    runtime_proof_work: 0,
  };
  for (const value of values) {
    if (Object.hasOwn(counts, value)) {
      counts[value] += 1;
    }
  }
  return counts;
}

function buildPersistentPriorityRecords({ cycleId, entries, selection, dispatch }) {
  return entries.map((entry) => ({
    priority_id: priorityIdForOpportunity(cycleId, entry),
    opportunity_id: entry.id,
    status: resolvePriorityStatus(entry, selection, dispatch),
    score: entry.score,
    reason: resolvePriorityReason(entry, selection),
    budget_bucket: entry.budget_bucket,
    authority_cost: entry.authority_cost,
    proof_strength: entry.metrics?.proof_strength ?? 0,
    tractability: entry.metrics?.tractability ?? 0,
    evidence_at: entry.evidence_at,
    authority: buildAuthorityForOpportunity(entry),
  }));
}

function mergeRecentRecords(previousRecords, currentRecords, { idKey, maxItems = 48 }) {
  const currentIds = new Set(currentRecords.map((entry) => entry?.[idKey]).filter(Boolean));
  const merged = [
    ...normalizeCollection(previousRecords).filter((entry) => !currentIds.has(entry?.[idKey])),
    ...currentRecords,
  ];
  return merged.slice(-maxItems);
}

function priorityIdForOpportunity(cycleId, opportunity) {
  return `priority-${cycleId}-${slugifyRepoLike(opportunity.id)}`;
}

function cycleIdForGeneratedAt(generatedAt) {
  return `cycle-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function resolveTargetState({ repo, targetRepo, scored, selection }) {
  if (targetRepo === repo) {
    return "active";
  }
  if (selection?.selected?.target_repo === targetRepo) {
    return "active";
  }

  const repoOpportunities = scored.filter((entry) => entry.target_repo === targetRepo);
  if (repoOpportunities.some((entry) => !entry.vetoed)) {
    return "eligible";
  }
  if (repoOpportunities.length > 0) {
    return "blocked";
  }
  return "candidate";
}

function resolvePriorityStatus(entry, selection, dispatch) {
  if (selection?.selected?.id === entry.id) {
    return dispatch?.status === "dispatched" ? "dispatched" : "selected";
  }
  return entry.vetoed ? "no_op" : "deferred";
}

function resolvePriorityReason(entry, selection) {
  if (selection?.selected?.id === entry.id) {
    return selection.reason ?? "selected_for_dispatch";
  }
  if (entry.vetoed) {
    return entry.veto_reasons?.join(", ") || "vetoed";
  }
  return "eligible_non_selected";
}

function buildAuthorityForSelection(selection) {
  if (selection?.selected) {
    return buildAuthorityForOpportunity(selection.selected);
  }
  return {
    scope: "none",
    approval_mode: "none",
    requires_human_approval: false,
    policy_basis: firstString(selection?.reason) || "no_selection",
    target_repo: null,
  };
}

function buildAuthorityForOpportunity(opportunity) {
  const lane = firstString(opportunity?.lane) || "unknown";
  const targetRepo = firstString(opportunity?.target_repo) || null;
  if (lane === "proving-ground") {
    return {
      scope: "internal_proof",
      approval_mode: "lane_preapproved",
      requires_human_approval: false,
      policy_basis: "prerelease_proving_ground_lane",
      target_repo: targetRepo,
    };
  }
  if (lane === "issue-triage") {
    return {
      scope: "public_triage",
      approval_mode: "workflow_gate",
      requires_human_approval: true,
      policy_basis: "issue_triage_public_routing_with_workflow_gates",
      target_repo: targetRepo,
    };
  }
  if (lane === "skill-lab") {
    return {
      scope: "draft_pr",
      approval_mode: "pr_review",
      requires_human_approval: true,
      policy_basis: "skill_lab_draft_pr_review",
      target_repo: targetRepo,
    };
  }
  return {
    scope: "draft_pr",
    approval_mode: "workflow_gate",
    requires_human_approval: true,
    policy_basis: `bounded_${lane}_workflow_gate`,
    target_repo: targetRepo,
  };
}

function buildDispatchRecord({ dispatch, selection, repo }) {
  return {
    status: firstString(dispatch?.status) || "no_dispatch",
    workflow: firstString(dispatch?.workflow) || null,
    ref: firstString(dispatch?.ref) || null,
    target_repo: firstString(dispatch?.target_repo)
      || firstString(dispatch?.inputs?.target_repo)
      || firstString(selection?.selected?.target_repo)
      || null,
    subject_locator: firstString(dispatch?.subject_locator)
      || firstString(selection?.selected?.subject_locator)
      || null,
    score: typeof dispatch?.score === "number"
      ? dispatch.score
      : typeof selection?.selected?.score === "number"
        ? selection.selected.score
        : null,
    inputs: Object.fromEntries(
      Object.entries(dispatch?.inputs ?? {})
        .map(([key, value]) => [key, String(value)])
        .filter(([, value]) => value.length > 0),
    ),
  };
}

function buildTargetLifecycle({
  previousTarget,
  targetRepo,
  generatedAt,
  cycleId,
  cycleStatus,
  cycleReason,
  selection,
  dispatch,
}) {
  const previousLifecycle = isPlainRecord(previousTarget?.lifecycle) ? previousTarget.lifecycle : {};
  const selectedTarget = firstString(selection?.selected?.target_repo) === targetRepo;
  const dispatchedTarget = selectedTarget && dispatch?.status === "dispatched";
  return {
    last_evaluated_at: generatedAt,
    last_selected_at: selectedTarget
      ? generatedAt
      : firstString(previousLifecycle.last_selected_at) || null,
    last_dispatched_at: dispatchedTarget
      ? generatedAt
      : firstString(previousLifecycle.last_dispatched_at) || null,
    last_cycle_id: selectedTarget
      ? cycleId
      : firstString(previousLifecycle.last_cycle_id) || null,
    last_cycle_status: selectedTarget
      ? cycleStatus
      : firstString(previousLifecycle.last_cycle_status) || null,
    last_transition_reason: selectedTarget
      ? cycleReason
      : firstString(previousLifecycle.last_transition_reason) || null,
    evaluated_count: Number(previousLifecycle.evaluated_count ?? 0) + 1,
    selected_count: Number(previousLifecycle.selected_count ?? 0) + (selectedTarget ? 1 : 0),
    dispatched_count: Number(previousLifecycle.dispatched_count ?? 0) + (dispatchedTarget ? 1 : 0),
  };
}

function buildReflectionEntries(reflections, targetIdByRepo, generatedAt) {
  return normalizeCollection(reflections)
    .map((entry, index) => {
      const targetRepo = firstString(entry?.target_repo)
        || repoFromSubjectLocator(entry?.subject_locator);
      if (!targetRepo) {
        return null;
      }
      return {
        reflection_id: reflectionIdForEntry(entry, index),
        target_id: targetIdByRepo[targetRepo] ?? slugifyRepoLike(targetRepo),
        summary: firstString(entry?.excerpt) || firstString(entry?.title) || "reflection",
        outcome_status: firstString(entry?.frontmatter?.outcome_status) || firstString(entry?.frontmatter?.status) || "recorded",
        recorded_at: normalizeRecordedAt(entry?.date, generatedAt),
      };
    })
    .filter(Boolean);
}

function reflectionIdForEntry(entry, index) {
  const pathValue = firstString(entry?.path);
  if (pathValue) {
    return `reflection-${path.basename(pathValue, path.extname(pathValue))}`;
  }
  return `reflection-${index + 1}`;
}

function normalizeRecordedAt(value, fallback) {
  const candidate = firstString(value);
  if (!candidate) {
    return fallback;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return `${candidate}T00:00:00Z`;
  }
  return Number.isNaN(Date.parse(candidate)) ? fallback : new Date(candidate).toISOString();
}

function repoFromSubjectLocator(value) {
  const locator = firstString(value);
  if (!locator) {
    return "";
  }
  if (isRepoLocator(locator)) {
    return locator;
  }
  const [repoLike] = locator.split("#");
  return isRepoLocator(repoLike) ? repoLike : "";
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function isInternalAssociation(value) {
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(String(value ?? "").toUpperCase());
}

function isRepoLocator(value) {
  return /^[^/\s]+\/[^/\s]+$/.test(String(value ?? "").trim());
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function ageHours(now, value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 10_000;
  }
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function ageDays(now, value) {
  return ageHours(now, value) / 24;
}

function findRelevantMemory(memory, subjectLocator, targetRepo, lane) {
  const markdownMemory = [...memory.history, ...memory.reflections].filter((entry) => {
    if (entry.subject_locator && entry.subject_locator === subjectLocator) {
      return true;
    }
    if (entry.target_repo && entry.target_repo === targetRepo && entry.lane === lane) {
      return true;
    }
    return false;
  });
  const threadTeaching = (memory.thread_teaching ?? []).filter((entry) => {
    const record = entry?.thread_teaching_record ?? entry;
    if (record?.subject_locator && record.subject_locator === subjectLocator) {
      return true;
    }
    if (record?.target_repo && record.target_repo === targetRepo) {
      return true;
    }
    if (Array.isArray(record?.applies_to) && record.applies_to.includes(lane)) {
      return true;
    }
    return false;
  });
  return [...markdownMemory, ...threadTeaching];
}

function findLatestLaneDate(memory, lane) {
  return [...memory.history, ...memory.reflections]
    .filter((entry) => entry.lane === lane || entry.title.toLowerCase().includes(lane))
    .map((entry) => entry.date)
    .filter(Boolean)
    .sort()
    .at(-1);
}

function countRecentLaneExecutions(memory, lane, limit = 6) {
  return [...memory.history, ...memory.reflections]
    .filter((entry) => entry.lane === lane)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, limit)
    .length;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, content: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, content: raw };
  }
  const frontmatterBlock = raw.slice(4, end);
  const content = raw.slice(end + 5);
  const frontmatter = {};
  for (const line of frontmatterBlock.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, content };
}

function parseSectionCodeList(content, heading) {
  const section = matchSection(content, heading);
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const match = line.match(/`([^`]+)`/);
      return match ? match[1] : line.replace(/^-+\s*/, "").trim();
    })
    .filter(Boolean);
}

function parseSectionBullets(content, heading) {
  const section = matchSection(content, heading);
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, "").trim());
}

function parseCurrentOpportunities(content) {
  const section = matchSection(content, "Current Opportunities");
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const laneMatch = line.match(/^- `([^`]+)`:\s*(.+)$/);
      if (laneMatch) {
        return {
          lane: laneMatch[1],
          summary: laneMatch[2].trim(),
        };
      }
      return {
        lane: null,
        summary: line.replace(/^-+\s*/, "").trim(),
      };
    });
}

function parseRecentOutcomes(content) {
  const section = matchSection(content, "Recent Outcomes");
  if (!section) {
    return [];
  }

  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const withReceipt = line.match(/^- ([0-9-]+) · `([^`]+)` · `([^`]+)` · `([^`]+)` · (.+)$/);
      if (withReceipt) {
        const [, date, lane, status, receipt_id, summary] = withReceipt;
        return { date, lane, status, receipt_id, summary };
      }
      const withoutReceipt = line.match(/^- ([0-9-]+) · `([^`]+)` · `([^`]+)` · (.+)$/);
      if (!withoutReceipt) {
        return null;
      }
      const [, date, lane, status, summary] = withoutReceipt;
      return { date, lane, status, receipt_id: null, summary };
    })
    .filter(Boolean);
}

function matchSection(content, heading) {
  const pattern = new RegExp(`## ${escapeRegExp(heading)}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarkdown(content) {
  return String(content ?? "")
    .replace(/^#+\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .trim();
}

function mapCooldownStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (["completed", "success", "merged", "published"].includes(normalized)) {
    return "success";
  }
  if (["noop", "ignored", "stale", "silence"].includes(normalized)) {
    return "ignored";
  }
  if (["rejected", "corrected"].includes(normalized)) {
    return "rejected";
  }
  if (["spam", "minimized", "harmful"].includes(normalized)) {
    return "severe";
  }
  if (["failed", "error"].includes(normalized)) {
    return "failed";
  }
  return "success";
}

function laneWorkflow(lane) {
  return {
    "issue-triage": "issue-triage.yml",
    "skill-lab": "skill-lab.yml",
    "proving-ground": "proving-ground.yml",
  }[lane] ?? null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
