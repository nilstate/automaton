import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const artifactsDir = path.resolve(options.artifactsDir);
const observedAt = new Date().toISOString();

const pr = ghJson([
  "pr",
  "view",
  String(options.prNumber),
  "--repo",
  options.repo,
  "--json",
  [
    "author",
    "baseRefName",
    "files",
    "headRefName",
    "headRefOid",
    "isDraft",
    "mergeCommit",
    "mergedAt",
    "number",
    "reviewDecision",
    "state",
    "statusCheckRollup",
    "title",
    "updatedAt",
    "url",
  ].join(","),
]);

const checks = summarizeChecks(pr.statusCheckRollup ?? []);
const state = contributionState(pr, checks, options);
const files = Array.isArray(pr.files) ? pr.files.map(normalizeFile) : [];
const targetFile = files.find((file) => file.path === options.candidatePath);
const mergeCommit = typeof pr.mergeCommit?.oid === "string" ? pr.mergeCommit.oid : undefined;
const upstreamSkill = state === "accepted_upstream" && mergeCommit
  ? await readUpstreamSkill({
      repo: options.repo,
      path: options.candidatePath,
      ref: mergeCommit,
    })
  : undefined;
const registryOwner = options.registryOwner ?? splitRepo(options.repo).owner;
const skillId = upstreamSkill
  ? `${slugify(registryOwner)}/${slugify(upstreamSkill.frontmatter.name)}`
  : undefined;

const contributionStateRecord = {
  schema: "runx.skill_contribution_state.v1",
  observed_at: observedAt,
  state,
  target: {
    repo: options.repo,
    path: options.candidatePath,
    base: pr.baseRefName,
    head: pr.headRefName,
    head_commit: pr.headRefOid,
    merge_commit: mergeCommit,
  },
  pull_request: {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    is_draft: Boolean(pr.isDraft),
    merged_at: pr.mergedAt,
    review_decision: pr.reviewDecision,
    author: pr.author?.login,
    updated_at: pr.updatedAt,
  },
  checks,
  files,
  upstream_skill: upstreamSkill
    ? {
        name: upstreamSkill.frontmatter.name,
        description: upstreamSkill.frontmatter.description,
        path: options.candidatePath,
        commit: mergeCommit,
        blob_sha: upstreamSkill.blobSha,
        size: upstreamSkill.size,
        html_url: upstreamSkill.htmlUrl,
        raw_url: upstreamSkill.rawUrl,
      }
    : undefined,
  transition: {
    to: state,
    reason: transitionReason(state, pr, checks, targetFile),
  },
};

const feedEvent = {
  lane: "skill-contribution",
  status: statusForState(state, checks),
  timestamp: observedAt,
  summary: summaryForState(state, options.repo, checks, skillId),
  metadata: {
    lane: state === "accepted_upstream" ? "upstream-skill" : "skill-contribution-watch",
    feed_channel: "main",
    main_feed_eligible: true,
    state,
    target_repo: options.repo,
    skill_path: options.candidatePath,
    skill_id: skillId,
    pr_url: pr.url,
    pr_number: pr.number,
    upstream_commit: mergeCommit,
    upstream_blob_sha: upstreamSkill?.blobSha,
    checks_total: checks.total,
    checks_passed: checks.passed,
    checks_failed: checks.failed,
    failure_reason: state === "rejected_upstream" ? "Upstream PR closed without merge." : checks.failure_reason,
  },
};

await mkdir(artifactsDir, { recursive: true });
await writeJson(path.join(artifactsDir, "skill_contribution_state.json"), contributionStateRecord);
await writeJson(path.join(artifactsDir, "public_feed_event.json"), feedEvent);

let registryBindingRequest;
if (state === "accepted_upstream" && upstreamSkill && mergeCommit && skillId) {
  registryBindingRequest = {
    schema: "runx.registry_binding_request.v1",
    state: "accepted_upstream",
    requested_at: observedAt,
    skill: {
      id: skillId,
      name: upstreamSkill.frontmatter.name,
      description: upstreamSkill.frontmatter.description,
    },
    upstream: {
      host: "github.com",
      owner: splitRepo(options.repo).owner,
      repo: splitRepo(options.repo).name,
      path: options.candidatePath,
      commit: mergeCommit,
      blob_sha: upstreamSkill.blobSha,
      pr_url: pr.url,
      merged_at: pr.mergedAt,
      html_url: upstreamSkill.htmlUrl,
      raw_url: upstreamSkill.rawUrl,
    },
    registry: {
      owner: registryOwner,
      trust_tier: "upstream-owned",
      binding_path: `bindings/${slugify(registryOwner)}/${slugify(upstreamSkill.frontmatter.name)}/registry-binding.json`,
      x_yaml_path: `bindings/${slugify(registryOwner)}/${slugify(upstreamSkill.frontmatter.name)}/x.yaml`,
    },
    harness: {
      required: true,
      status: "pending",
    },
  };
  await writeJson(path.join(artifactsDir, "registry_binding_request.json"), registryBindingRequest);
}

process.stdout.write(`${JSON.stringify({
  status: "observed",
  state,
  repo: options.repo,
  pr_number: pr.number,
  skill_id: skillId,
  checks_total: checks.total,
  checks_passed: checks.passed,
  checks_failed: checks.failed,
  registry_binding_request: Boolean(registryBindingRequest),
  artifacts_dir: path.relative(process.cwd(), artifactsDir),
}, null, 2)}\n`);

async function readUpstreamSkill({ repo, path: skillPath, ref }) {
  const content = ghJson(["api", `repos/${repo}/contents/${encodePath(skillPath)}?ref=${encodeURIComponent(ref)}`]);
  if (typeof content.content !== "string") {
    throw new Error(`GitHub contents API did not return base64 content for ${repo}:${skillPath}@${ref}.`);
  }
  const markdown = Buffer.from(content.content.replace(/\n/g, ""), "base64").toString("utf8");
  return {
    markdown,
    frontmatter: parseSkillFrontmatter(markdown),
    blobSha: content.sha,
    size: content.size,
    htmlUrl: content.html_url,
    rawUrl: content.download_url,
  };
}

function contributionState(pr, checks, parsedOptions) {
  if (pr.state === "MERGED") {
    return checks.failed > 0 ? "maintainer_review" : "accepted_upstream";
  }
  if (pr.state === "CLOSED") {
    return "rejected_upstream";
  }
  if (pr.state === "OPEN") {
    if (isStale(pr.updatedAt, parsedOptions.staleAfterDays)) {
      return "stale_upstream";
    }
    return "maintainer_review";
  }
  return "submitted_upstream";
}

function summarizeChecks(rollup) {
  const items = rollup.map((entry) => {
    const status = entry.status ?? "UNKNOWN";
    const conclusion = entry.conclusion ?? entry.state ?? "UNKNOWN";
    const passed = conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED";
    const failed = conclusion === "FAILURE" || conclusion === "ERROR" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED";
    return {
      name: entry.name ?? entry.context ?? entry.workflowName ?? "check",
      workflow: entry.workflowName,
      status,
      conclusion,
      details_url: entry.detailsUrl ?? entry.targetUrl,
      completed_at: entry.completedAt,
      passed,
      failed,
    };
  });
  const completed = items.filter((item) => item.status === "COMPLETED" || item.conclusion !== "UNKNOWN");
  const failed = items.filter((item) => item.failed);
  const passed = items.filter((item) => item.passed);
  return {
    total: items.length,
    completed: completed.length,
    passed: passed.length,
    failed: failed.length,
    pending: Math.max(0, items.length - completed.length),
    conclusion: failed.length > 0 ? "failure" : items.length === 0 || completed.length < items.length ? "pending" : "success",
    failure_reason: failed.length > 0 ? failed.map((item) => `${item.name}: ${item.conclusion}`).join("; ") : undefined,
    items,
  };
}

function transitionReason(state, pr, checks, targetFile) {
  if (state === "accepted_upstream") {
    return `PR #${pr.number} merged and ${targetFile?.path ?? "candidate path"} is present with ${checks.passed}/${checks.total} checks passing.`;
  }
  if (state === "rejected_upstream") {
    return `PR #${pr.number} is closed without merge.`;
  }
  if (state === "stale_upstream") {
    return `PR #${pr.number} has not been updated inside the configured follow-up window.`;
  }
  if (checks.failed > 0) {
    return checks.failure_reason;
  }
  return `PR #${pr.number} is still under upstream maintainer review.`;
}

function summaryForState(state, repo, checks, skillId) {
  if (state === "accepted_upstream") {
    return `Upstream accepted ${repo} SKILL.md; ${skillId ?? "registry binding"} is ready for runx binding.`;
  }
  if (state === "rejected_upstream") {
    return `Upstream closed ${repo} SKILL.md contribution without merge.`;
  }
  if (state === "stale_upstream") {
    return `${repo} SKILL.md contribution is stale and needs a respectful follow-up decision.`;
  }
  return `${repo} SKILL.md contribution remains under review; ${checks.passed}/${checks.total} checks passing.`;
}

function statusForState(state, checks) {
  if (state === "rejected_upstream") {
    return "failure";
  }
  if (checks.failed > 0) {
    return "failure";
  }
  return "success";
}

function normalizeFile(file) {
  return {
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    change_type: file.changeType,
  };
}

function parseSkillFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error("Upstream SKILL.md is missing YAML frontmatter.");
  }
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) {
      continue;
    }
    frontmatter[field[1]] = field[2].replace(/^['"]|['"]$/g, "").trim();
  }
  if (!frontmatter.name) {
    throw new Error("Upstream SKILL.md frontmatter is missing name.");
  }
  return frontmatter;
}

function isStale(updatedAt, staleAfterDays) {
  if (!updatedAt || staleAfterDays <= 0) {
    return false;
  }
  const updated = Date.parse(updatedAt);
  return Number.isFinite(updated) && Date.now() - updated > staleAfterDays * 24 * 60 * 60 * 1000;
}

function ghJson(args) {
  const raw = execFileSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw);
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function splitRepo(repo) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Repository must be owner/name: ${repo}`);
  }
  return { owner, name };
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error("Slug cannot be empty.");
  }
  return slug;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    artifactsDir: ".artifacts/skill-contribution-watch",
    candidatePath: "SKILL.md",
    staleAfterDays: 21,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      parsed.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr") {
      parsed.prNumber = Number.parseInt(requireValue(argv, ++index, token), 10);
      continue;
    }
    if (token === "--candidate-path") {
      parsed.candidatePath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifacts-dir") {
      parsed.artifactsDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--registry-owner") {
      parsed.registryOwner = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--stale-after-days") {
      parsed.staleAfterDays = Number.parseInt(requireValue(argv, ++index, token), 10);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!parsed.repo) {
    throw new Error("--repo is required.");
  }
  if (!Number.isInteger(parsed.prNumber) || parsed.prNumber <= 0) {
    throw new Error("--pr must be a positive integer.");
  }
  if (path.isAbsolute(parsed.candidatePath) || parsed.candidatePath.includes("..")) {
    throw new Error("--candidate-path must be relative and confined to the target repo.");
  }
  if (!Number.isFinite(parsed.staleAfterDays)) {
    throw new Error("--stale-after-days must be a number.");
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
