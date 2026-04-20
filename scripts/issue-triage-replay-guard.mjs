import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  computeIssueFingerprint,
  parseIssueTriageCommentMetadata,
} from "./issue-triage-markers.mjs";

const defaultRunner = (command, args) => execFileSync(command, args, { encoding: "utf8" });

export async function issueTriageReplayGuard(argv = process.argv.slice(2), runner = defaultRunner) {
  const options = parseArgs(argv);
  const plan = buildReplayGuardPlan({
    ...options,
    comments: loadComments(options, runner),
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

export function buildReplayGuardPlan({
  mode,
  issue,
  pr,
  title,
  body,
  sha,
  comments = [],
}) {
  if (mode === "issue") {
    const fingerprint = computeIssueFingerprint({ title, body });
    const existing = comments.find((comment) => {
      const metadata = parseIssueTriageCommentMetadata(comment?.body);
      return metadata.has_marker && metadata.fingerprint === fingerprint;
    });
    if (existing) {
      return {
        status: "skip",
        reason: "duplicate_issue_fingerprint",
        fingerprint,
      };
    }
    return {
      status: "run",
      fingerprint,
      issue,
    };
  }

  const existing = comments.find((comment) => {
    const metadata = parseIssueTriageCommentMetadata(comment?.body);
    return metadata.has_marker && metadata.sha === sha;
  });
  if (existing) {
    return {
      status: "skip",
      reason: "duplicate_pr_head_sha",
      sha,
    };
  }

  return {
    status: "run",
    sha,
    pr,
  };
}

function loadComments(options, runner) {
  if (options.mode === "issue") {
    const issue = JSON.parse(
      runner("gh", [
        "issue",
        "view",
        options.issue,
        "--repo",
        options.repo,
        "--json",
        "comments",
      ]),
    );
    return issue.comments ?? [];
  }

  const pr = JSON.parse(
    runner("gh", [
      "pr",
      "view",
      options.pr,
      "--repo",
      options.repo,
      "--json",
      "comments",
    ]),
  );
  return pr.comments ?? [];
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode") {
      options.mode = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue") {
      options.issue = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr") {
      options.pr = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--title") {
      options.title = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--body") {
      options.body = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--sha") {
      options.sha = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!["issue", "pr"].includes(options.mode)) {
    throw new Error("--mode must be `issue` or `pr`.");
  }
  if (!options.repo) {
    throw new Error("--repo is required.");
  }
  if (options.mode === "issue" && (!options.issue || !options.title)) {
    throw new Error("--issue and --title are required for issue mode.");
  }
  if (options.mode === "pr" && (!options.pr || !options.sha)) {
    throw new Error("--pr and --sha are required for pr mode.");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await issueTriageReplayGuard();
}
