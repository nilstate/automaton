import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { evaluateLaneChangeSurfacePolicy } from "./change-surface-governance.mjs";
import { ensureGeneratedPrPolicyBlock } from "./generated-pr-policy.mjs";
import { normalizeAutomationBranchName } from "./aster-v1-contracts.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.branch = normalizePublishBranchName(options.branch);
  const base = options.base ?? defaultBranch(options.repo);
  const existingPr = findExistingPr(options.repo, options.branch);
  const remoteLease = ensureRemoteLease(options.branch);
  const ownerRepo = options.ownerRepo ?? process.env.GITHUB_REPOSITORY ?? "nilstate/aster";

  if (!hasWorkingTreeChanges()) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "noop",
          reason: "working tree clean",
          pr_number: existingPr?.number ?? null,
          pr_url: existingPr?.url ?? null,
          policy: {
            lane: options.lane,
            merge_policy: "human_review",
            draft_only: true,
          },
          change_surface_policy: null,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (currentBranchName() !== options.branch) {
    run("git", buildCheckoutArgs(options.branch, remoteLease));
  }
  run("git", ["add", "-A"]);
  const changeSummary = summarizeStagedChanges();
  const changeSurfacePolicy = evaluateLaneChangeSurfacePolicy({
    lane: options.lane,
    repo: options.repo,
    ownerRepo,
    files: changeSummary.files,
  });

  if (!hasStagedChanges()) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "noop",
          reason: "no staged changes",
          pr_number: existingPr?.number ?? null,
          pr_url: existingPr?.url ?? null,
          policy: {
            lane: options.lane,
            merge_policy: "human_review",
            draft_only: true,
          },
          change_surface_policy: changeSurfacePolicy,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (changeSurfacePolicy.status === "blocked") {
    throw new Error(`change surface policy blocked publication: ${changeSurfacePolicy.reasons.join(", ")}`);
  }

  const prBody = ensureGeneratedPrPolicyBlock(readFileSync(options.bodyFile, "utf8"), {
    lane: options.lane,
    changeSurfacePolicy,
  });

  run("git", ["commit", "-m", options.commitMessage]);
  run("git", buildPushArgs(options.branch, remoteLease));

  let pr = findExistingPr(options.repo, options.branch);
  if (!pr) {
    run("gh", [
      "pr",
      "create",
      "--repo",
      options.repo,
      "--draft",
      "--base",
      base,
      "--head",
      options.branch,
      "--title",
      options.title,
      "--body",
      prBody,
    ]);
      pr = findExistingPr(options.repo, options.branch);
  } else {
    updatePullRequest(options.repo, pr.number, {
      title: options.title,
      body: prBody,
    });
  }

  if (!pr) {
    throw new Error(`Could not resolve the published pull request for branch ${options.branch}.`);
  }

  if (options.issueNumber) {
    run("gh", [
      "issue",
      "comment",
      options.issueNumber,
      "--repo",
      options.issueRepo ?? options.repo,
      "--body",
      `Opened draft PR for this run: ${pr.url}`,
    ]);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "published",
        branch: options.branch,
        base,
        pr_number: pr.number,
        pr_url: pr.url,
        policy: {
          lane: options.lane,
          merge_policy: "human_review",
          draft_only: true,
        },
        change_summary: changeSummary,
        change_surface_policy: changeSurfacePolicy,
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--branch") {
      options.branch = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--title") {
      options.title = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--commit-message") {
      options.commitMessage = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--body-file") {
      options.bodyFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--base") {
      options.base = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-number") {
      options.issueNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-repo") {
      options.issueRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--owner-repo") {
      options.ownerRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--close-existing-if-noop") {
      options.closeExistingIfNoop = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  for (const required of ["repo", "branch", "title", "commitMessage", "bodyFile", "lane"]) {
    if (!options[required]) {
      throw new Error(`--${required.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required.`);
    }
  }

  return options;
}

export function normalizePublishBranchName(branch) {
  return normalizeAutomationBranchName(branch, "publish branch");
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

export function ensureRemoteLease(branch, runner = run) {
  const listing = runner("git", ["ls-remote", "--heads", "origin", branch]).trim();
  if (!listing) {
    return null;
  }

  const [remoteTip] = listing.split(/\s+/, 1);
  runner("git", ["fetch", "--no-tags", "origin", `${branch}:refs/remotes/origin/${branch}`]);
  return remoteTip;
}

export function buildPushArgs(branch, remoteLease) {
  return ["push", "-u", "origin", branch];
}

export function buildCheckoutArgs(branch, remoteLease) {
  if (remoteLease) {
    return ["checkout", "-B", branch, `refs/remotes/origin/${branch}`];
  }
  return ["checkout", "-B", branch];
}

function hasWorkingTreeChanges() {
  return run("git", ["status", "--porcelain"]).trim().length > 0;
}

export function currentBranchName(runner = run) {
  return runner("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

export function buildPullRequestUpdateArgs(repo, prNumber) {
  return [
    "api",
    `repos/${repo}/pulls/${prNumber}`,
    "--method",
    "PATCH",
    "--input",
    "-",
  ];
}

function updatePullRequest(repo, prNumber, payload) {
  return execFileSync("gh", buildPullRequestUpdateArgs(repo, prNumber), {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: JSON.stringify(payload),
  });
}

function hasStagedChanges() {
  try {
    run("git", ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

function summarizeStagedChanges() {
  const report = run("git", ["diff", "--cached", "--numstat"]).trim();
  if (!report) {
    return {
      file_count: 0,
      additions: 0,
      deletions: 0,
      files: [],
    };
  }

  const files = [];
  let additions = 0;
  let deletions = 0;
  for (const line of report.split("\n")) {
    const [added, removed, file] = line.split("\t");
    additions += Number(added) || 0;
    deletions += Number(removed) || 0;
    if (file) {
      files.push(file);
    }
  }

  return {
    file_count: files.length,
    additions,
    deletions,
    files: files.slice(0, 20),
  };
}

function defaultBranch(repo) {
  const report = JSON.parse(
    run("gh", ["repo", "view", repo, "--json", "defaultBranchRef"]),
  );
  return report.defaultBranchRef.name;
}

function findExistingPr(repo, branch) {
  const listing = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,url",
    ]),
  );
  return listing[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
