import { readFile } from "node:fs/promises";
import path from "node:path";

import { inferGeneratedPrLane } from "./generated-pr-policy.mjs";
import { evaluatePublicCommentOpportunity } from "./public-work-policy.mjs";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await checkIssueTriagePrPolicy(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function checkIssueTriagePrPolicy(options) {
  const snapshot = JSON.parse(await readFile(path.resolve(options.snapshot), "utf8"));
  const dossier = options.dossier ? await loadTargetDossier(path.resolve(options.dossier)) : null;
  const generatedLane = inferGeneratedPrLane({
    headRefName: snapshot.head_ref,
    title: snapshot.title,
    body: snapshot.body,
  });
  if (generatedLane === "issue-triage" || generatedLane === "evidence-projection-derive") {
    return {
      allowed: false,
      reasons: [generatedLane === "issue-triage" ? "generated_issue_triage_pr" : "generated_evidence_projection_pr"],
      welcome_signal: false,
      target_subject_locator: dossier?.subject_locator ?? null,
      generated_lane: generatedLane,
    };
  }
  const policy = evaluatePublicCommentOpportunity({
    source: "github_pull_request",
    lane: options.lane ?? "issue-triage",
    authorLogin: snapshot.author,
    authorAssociation: snapshot.author_association,
    title: snapshot.title,
    labels: snapshot.labels,
    headRefName: snapshot.head_ref,
    commentsCount: snapshot.comment_count ?? (snapshot.recent_comments ?? []).length,
    reviewCommentsCount: snapshot.review_count ?? (snapshot.recent_reviews ?? []).length,
    recentOutcomes: dossier?.recent_outcomes ?? [],
  });
  return {
    allowed: !policy.blocked,
    reasons: policy.reasons,
    welcome_signal: policy.welcome_signal,
    target_subject_locator: dossier?.subject_locator ?? null,
    generated_lane: generatedLane === "unknown" ? null : generatedLane,
  };
}

async function loadTargetDossier(filePath) {
  const raw = await readFile(filePath, "utf8");
  const locatorMatch = raw.match(/^subject_locator:\s*(.+)$/m);
  return {
    subject_locator: locatorMatch ? locatorMatch[1].trim() : null,
    recent_outcomes: parseRecentOutcomes(raw),
  };
}

function parseRecentOutcomes(content) {
  const match = content.match(/## Recent Outcomes\n([\s\S]*?)(?=\n## |\s*$)/);
  if (!match) {
    return [];
  }
  return match[1]
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--snapshot") {
      options.snapshot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--dossier") {
      options.dossier = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.snapshot) {
    throw new Error("--snapshot is required.");
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
