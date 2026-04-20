import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateCommentQuality } from "./evaluate-comment-quality.mjs";
import { evaluateGeneratedPr } from "./evaluate-generated-pr.mjs";
import { buildGeneratedPrPolicyPlan, ensureGeneratedPrPolicyBlock } from "./generated-pr-policy.mjs";
import { buildIssueTriageComment } from "./issue-triage-markers.mjs";
import { buildReplayGuardPlan } from "./issue-triage-replay-guard.mjs";
import { buildRollbackPlan } from "./rollback-run.mjs";
import { buildLaneRequestBody } from "./run-governed-pr-lane.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await buildOperatorShakeoutReport({
    repoRoot,
    publishEvidencePath: options.publishEvidencePath,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export async function buildOperatorShakeoutReport({ repoRoot, publishEvidencePath }) {
  const publishEvidence = await readFile(
    path.resolve(repoRoot, publishEvidencePath ?? ".github/workflows/publish-public-evidence.yml"),
    "utf8",
  );
  const docsPrBody = buildLaneRequestBody("docs-pr", "Clarify the deployment story.");
  const fixPrBody = buildLaneRequestBody("fix-pr", "Fix the activity ordering bug.");
  const commentEval = evaluateCommentQuality({
    body: buildIssueTriageComment({
      body: [
        "Thanks for the report.",
        "",
        "- Please reproduce the ordering bug with one concrete example.",
        "- Update the feed guard once the failing case is confirmed so the next change stays bounded.",
      ].join("\n"),
      fingerprint: "abc12345deadbeef",
    }),
    subjectKind: "github_issue",
    subjectLocator: "nilstate/aster#issue/101",
  });
  const generatedBody = ensureGeneratedPrPolicyBlock("## Summary\n\nBounded PR body.", {
    lane: "docs-pr",
  });
  const generatedEval = evaluateGeneratedPr({
    publish: {
      status: "published",
      policy: { lane: "docs-pr" },
      change_summary: { file_count: 1, additions: 4, deletions: 0 },
      change_surface_policy: {
        status: "allowed",
        internal_repo: true,
        surfaces: ["working_docs", "repo_meta"],
        reasons: [],
      },
    },
    body: ensureGeneratedPrPolicyBlock(generatedBody, {
      lane: "docs-pr",
      changeSurfacePolicy: {
        status: "allowed",
        internal_repo: true,
        surfaces: ["working_docs", "repo_meta"],
        reasons: [],
      },
    }),
    validation: {
      commands: ["npm run site:ci"],
      verification_profile: "aster.site-ci",
    },
  });
  const replayIssue = buildReplayGuardPlan({
    mode: "issue",
    issue: "101",
    title: "Clarify deploy docs",
    body: "Docs drift exists.",
    comments: [],
  });
  const replayPr = buildReplayGuardPlan({
    mode: "pr",
    pr: "12",
    sha: "abc1234",
    comments: [],
  });
  const policyPlan = buildGeneratedPrPolicyPlan({
    headRefName: "runx/docs-pr-clarify-deploy-docs",
    title: "[runx] docs-pr: Clarify deploy docs",
    body: "## Summary\n\nDocs only.",
    isDraft: false,
  });
  const rollbackPlan = buildRollbackPlan({
    mode: "pr-comment",
    repo: "nilstate/aster",
    pr: "12",
    reason: "Superseded by a narrower correction.",
    replacementBody: "Please review only the deployment note changes.",
  });

  const workflowChecks = [
    ".github/workflows/aster-cycle.yml",
    ".github/workflows/site-pages.yml",
    ".github/workflows/generated-pr-policy.yml",
    ".github/workflows/rollback.yml",
    ".github/workflows/docs-pr.yml",
    ".github/workflows/fix-pr.yml",
    ".github/workflows/issue-triage.yml",
    ".github/workflows/proving-ground.yml",
    ".github/workflows/skill-upstream.yml",
    ".github/workflows/merge-watch.yml",
    ".github/workflows/skill-lab.yml",
  ].map((relativePath) => ({
    name: relativePath,
    ok: publishEvidence.includes(path.basename(relativePath, ".yml")),
  }));

  const checks = {
    docs_pr_constraints_present: /docs-only/i.test(docsPrBody),
    fix_pr_constraints_present: /bounded bugfix/i.test(fixPrBody),
    comment_eval_passes: commentEval.status === "pass",
    generated_pr_eval_passes: generatedEval.status === "pass",
    issue_replay_guard_runs: replayIssue.status === "run",
    pr_replay_guard_runs: replayPr.status === "run",
    generated_pr_policy_enforces: policyPlan.status === "enforce",
    rollback_plan_ready: rollbackPlan.status === "ready",
    evidence_workflows_listed: workflowChecks.every((entry) => entry.ok),
  };

  return {
    status: Object.values(checks).every(Boolean) ? "pass" : "fail",
    checks,
    workflow_checks: workflowChecks,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--publish-evidence-path") {
      options.publishEvidencePath = argv[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
