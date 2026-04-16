import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { slugifyRepoLike } from "./build-automaton-context.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runAutomatonCycle(options);
  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  }
  if (options.summaryOutput) {
    await writeFile(path.resolve(options.summaryOutput), `${renderCycleSummary(result)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runAutomatonCycle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const repo = options.repo ?? "nilstate/automaton";
  const now = options.now ? new Date(options.now) : new Date();
  const policy = await loadScoringPolicy(path.join(repoRoot, "doctrine", "SCORING.md"));
  const dossiers = await loadTargetDossiers(path.join(repoRoot, "state", "targets"));
  const targetRepos = unique([
    repo,
    ...Object.values(dossiers).map((entry) => entry.subject_locator).filter(isRepoLocator),
  ]);
  const memory = await loadOperatorMemory(repoRoot);
  const discovery = options.discoveryInput
    ? JSON.parse(await readFile(path.resolve(options.discoveryInput), "utf8"))
    : await fetchGitHubDiscovery(targetRepos, {
        maxIssues: Number(options.maxIssues ?? 20),
        maxPrs: Number(options.maxPrs ?? 20),
      });
  const openOperatorMemoryBranches = options.openOperatorMemoryBranches
    ?? (options.openOperatorMemoryInput
      ? JSON.parse(await readFile(path.resolve(options.openOperatorMemoryInput), "utf8"))
      : options.discoveryInput
        ? []
        : await loadOpenOperatorMemoryBranches(repo));

  const opportunities = discoverOpportunities({
    repo,
    discovery,
    dossiers,
    memory,
    now,
  });
  const scored = scoreOpportunities({
    opportunities,
    dossiers,
    memory,
    policy,
    now,
    openOperatorMemoryBranches,
  });
  const selection = selectOpportunity({
    scored,
    policy,
  });
  const dispatchPlan = buildDispatchPlan({
    repo,
    selection,
    dispatchRef: options.dispatchRef ?? "main",
  });
  const dispatchResult = options.dispatch
    ? dispatchLane(dispatchPlan)
    : dispatchPlan;

  return {
    generated_at: now.toISOString(),
    repo,
    policy,
    opportunity_count: scored.length,
    opportunities: scored,
    selection,
    dispatch: dispatchResult,
  };
}

export async function loadScoringPolicy(filePath) {
  const raw = await readFile(filePath, "utf8");
  const weightPattern = /- `([^`]+)`: `([0-9.]+)`/g;
  const weights = {};
  for (const match of raw.matchAll(weightPattern)) {
    const [, key, value] = match;
    weights[key] = Number(value);
  }

  return {
    weights,
    thresholds: {
      stranger_value_min: extractThreshold(raw, /stranger_value < ([0-9.]+)/, 0.6),
      proof_strength_min: extractThreshold(raw, /proof_strength < ([0-9.]+)/, 0.7),
      minimum_select_score: extractThreshold(raw, /scores below `([0-9.]+)`/, 0.68),
    },
    cooldown_hours: {
      success: extractCooldown(raw, ["completed", "success", "merged", "published"], 72),
      ignored: extractCooldown(raw, ["noop", "ignored", "stale", "silence"], 24 * 7),
      rejected: extractCooldown(raw, ["rejected", "corrected"], 24 * 21),
      failed: extractCooldown(raw, ["failed", "error"], 24),
    },
  };
}

export function discoverOpportunities({ repo, discovery, dossiers, memory, now }) {
  const opportunities = [];

  for (const [targetRepo, targetDiscovery] of Object.entries(normalizeDiscovery(discovery, repo))) {
    const issues = normalizeCollection(targetDiscovery.issues);
    const prs = normalizeCollection(targetDiscovery.prs);
    const dossier = dossiers[slugifyRepoLike(targetRepo)] ?? null;

    for (const issue of issues) {
      const lane = String(issue.title ?? "").startsWith("[skill]") && targetRepo === repo
        ? "skill-learning"
        : "issue-supervisor";
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
        id: `pr-${targetRepo}-${pr.number}-pr-triage`,
        lane: "pr-triage",
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
        updated_at: updatedAt,
        age_days: ageDays(now, updatedAt),
        stale_days: ageDays(now, updatedAt),
        is_draft: Boolean(pr.isDraft ?? pr.is_draft),
        head_ref_name: firstString(pr.headRefName ?? pr.head_ref_name),
        dossier,
        memory_records: findRelevantMemory(memory, `${targetRepo}#pr/${pr.number}`, targetRepo, "pr-triage"),
      });
    }
  }

  opportunities.push(
    buildMaintenanceOpportunity({
      lane: "sourcey-refresh",
      repo,
      dossiers,
      memory,
      now,
      title: "Refresh the transitional docs surface",
    }),
  );
  opportunities.push(
    buildMaintenanceOpportunity({
      lane: "runx-dogfood",
      repo,
      dossiers,
      memory,
      now,
      title: "Run bounded dogfood to surface receipt and governance drift",
    }),
  );

  return opportunities;
}

export function scoreOpportunities({ opportunities, dossiers, memory, policy, now, openOperatorMemoryBranches = [] }) {
  return opportunities
    .map((opportunity) => scoreOpportunity({
      opportunity,
      dossiers,
      memory,
      policy,
      now,
      openOperatorMemoryBranches,
    }))
    .sort((left, right) => right.score - left.score);
}

export function scoreOpportunity({ opportunity, dossiers, memory, policy, now, openOperatorMemoryBranches = [] }) {
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

  const cooldown = computeCooldown({
    lane: opportunity.lane,
    recentOutcomes,
    now,
    policy,
  });
  const lane_allowed = allowedLanes.length === 0 || allowedLanes.includes(opportunity.lane);
  const within_v1_scope = dossier !== null || opportunity.target_repo === "nilstate/automaton";
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
  const operatorMemoryBranch = operatorMemoryBranchForOpportunity(opportunity);
  if (operatorMemoryBranch && openOperatorMemoryBranches.includes(operatorMemoryBranch)) {
    veto_reasons.push("open_operator_memory_pr");
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
    lane_allowed,
    within_v1_scope,
    metrics,
    score,
    cooldown,
    veto_reasons,
    vetoed: veto_reasons.length > 0,
  };
}

export function selectOpportunity({ scored, policy }) {
  const priorities = scored.slice(0, 3);
  const eligible = scored.filter((entry) => !entry.vetoed);
  if (eligible.length === 0) {
    return {
      status: "no_op",
      reason: "all_candidates_vetoed",
      priorities,
      selected: null,
    };
  }

  const [top] = eligible;
  if (top.score < policy.thresholds.minimum_select_score) {
    return {
      status: "no_op",
      reason: "top_candidate_below_selection_threshold",
      priorities,
      selected: null,
    };
  }

  return {
    status: "selected",
    reason: "highest_non_vetoed_score",
    priorities,
    selected: top,
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
    plan.repo ?? "nilstate/automaton",
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
    "# Automaton Cycle",
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
      "[ .[] | { number, title, body, url: .html_url, isDraft: (.draft // false), author: { login: .user.login }, authorAssociation: .author_association, createdAt: .created_at, updatedAt: .updated_at, headRefName: .head.ref, baseRefName: .base.ref } ]",
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
      recent_outcomes: parseRecentOutcomes(content),
      trust_notes: parseSectionBullets(content, "Trust Notes"),
    };
  }

  return dossiers;
}

async function loadOpenOperatorMemoryBranches(repo) {
  const listing = JSON.parse(run("gh", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "headRefName",
  ]));
  return normalizeCollection(listing)
    .map((entry) => firstString(entry?.headRefName))
    .filter((branch) => branch.startsWith("runx/operator-memory-"));
}

async function loadOperatorMemory(repoRoot) {
  return {
    history: await loadMarkdownMemory(path.join(repoRoot, "history"), repoRoot),
    reflections: await loadMarkdownMemory(path.join(repoRoot, "reflections"), repoRoot),
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
    const base = opportunity.is_external ? 0.84 : 0.62;
    return clamp(base + Math.min(opportunity.stale_days / 45, 0.06));
  }
  if (opportunity.lane === "sourcey-refresh") {
    return clamp(0.48 + Math.min(opportunity.stale_days / 90, 0.22));
  }
  if (opportunity.lane === "runx-dogfood") {
    return clamp(0.46 + Math.min(opportunity.stale_days / 60, 0.24));
  }
  return 0.5;
}

function computeProofStrength(opportunity) {
  if (opportunity.source === "github_pull_request") {
    return 0.96;
  }
  if (opportunity.source === "github_issue") {
    return 0.92;
  }
  if (opportunity.lane === "sourcey-refresh") {
    return 0.76;
  }
  if (opportunity.lane === "runx-dogfood") {
    return 0.74;
  }
  return 0.72;
}

function computeCompoundingValue(opportunity, dossier) {
  let score = 0.68;
  if (opportunity.target_repo === "nilstate/automaton") {
    score += 0.09;
  }
  if (opportunity.target_repo === "nilstate/runx") {
    score += 0.11;
  }
  if (dossier?.default_lanes?.includes(opportunity.lane)) {
    score += 0.05;
  }
  if (["pr-triage", "issue-supervisor"].includes(opportunity.lane)) {
    score += 0.04;
  }
  return clamp(score);
}

function computeTractability(opportunity) {
  if (opportunity.source === "github_pull_request") {
    let score = opportunity.is_draft ? 0.63 : 0.78;
    if (opportunity.body_length < 1600) {
      score += 0.05;
    }
    return clamp(score);
  }
  if (opportunity.source === "github_issue") {
    let score = opportunity.lane === "skill-learning" ? 0.63 : 0.72;
    if (opportunity.body_length < 1800) {
      score += 0.05;
    }
    return clamp(score);
  }
  if (opportunity.lane === "sourcey-refresh") {
    return 0.74;
  }
  if (opportunity.lane === "runx-dogfood") {
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
  if (opportunity.lane === "pr-triage") {
    return 0.82;
  }
  if (opportunity.lane === "issue-supervisor") {
    return 0.76;
  }
  if (opportunity.lane === "skill-learning") {
    return 0.6;
  }
  if (opportunity.lane === "sourcey-refresh") {
    return 0.64;
  }
  if (opportunity.lane === "runx-dogfood") {
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
    if (token === "--open-operator-memory-input") {
      options.openOperatorMemoryInput = requireValue(argv, ++index, token);
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

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function isInternalAssociation(value) {
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(String(value ?? "").toUpperCase());
}

function isRepoLocator(value) {
  return /^[^/\s]+\/[^/\s]+$/.test(String(value ?? "").trim());
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
  return [...memory.history, ...memory.reflections].filter((entry) => {
    if (entry.subject_locator && entry.subject_locator === subjectLocator) {
      return true;
    }
    if (entry.target_repo && entry.target_repo === targetRepo && entry.lane === lane) {
      return true;
    }
    return false;
  });
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

function operatorMemoryBranchForOpportunity(opportunity) {
  const targetSlug = slugifyRepoLike(opportunity.target_repo ?? opportunity.subject_locator);
  if (!targetSlug || !opportunity.lane) {
    return null;
  }
  if (opportunity.pr_number) {
    return `runx/operator-memory-${opportunity.lane}-${targetSlug}-pr-${opportunity.pr_number}`;
  }
  if (opportunity.issue_number) {
    return `runx/operator-memory-${opportunity.lane}-${targetSlug}-issue-${opportunity.issue_number}`;
  }
  return null;
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
      const match = line.match(/^- ([0-9-]+) · `([^`]+)` · `([^`]+)` · (.+)$/);
      if (!match) {
        return null;
      }
      const [, date, lane, status, summary] = match;
      return { date, lane, status, summary };
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
  if (["failed", "error"].includes(normalized)) {
    return "failed";
  }
  return "success";
}

function extractThreshold(raw, pattern, fallback) {
  const match = raw.match(pattern);
  return match ? Number(match[1]) : fallback;
}

function extractCooldown(raw, labels, fallback) {
  const matchingLine = raw
    .split("\n")
    .find((line) => labels.every((label) => line.includes(`\`${label}\``)));
  if (!matchingLine) {
    return fallback;
  }

  const hourMatch = matchingLine.match(/`([0-9]+)h`/);
  if (hourMatch) {
    return Number(hourMatch[1]);
  }
  const dayMatch = matchingLine.match(/`([0-9]+)d`/);
  if (dayMatch) {
    return Number(dayMatch[1]) * 24;
  }
  const compactMatch = matchingLine.match(/([0-9]+)(h|d)/);
  if (compactMatch) {
    return compactMatch[2] === "d" ? Number(compactMatch[1]) * 24 : Number(compactMatch[1]);
  }
  return fallback;
}

function laneWorkflow(lane) {
  return {
    "issue-supervisor": "issue-supervisor.yml",
    "pr-triage": "pr-triage.yml",
    "skill-learning": "skill-learning.yml",
    "sourcey-refresh": "sourcey-refresh.yml",
    "runx-dogfood": "runx-dogfood.yml",
  }[lane] ?? null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
