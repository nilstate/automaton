import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

import { checkIssueTriagePrPolicy } from "./check-issue-triage-pr-policy.mjs";

test("checkIssueTriagePrPolicy blocks bot dependency PRs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-pr-policy-"));
  const snapshotPath = path.join(tempRoot, "snapshot.json");
  await writeFile(
    snapshotPath,
    `${JSON.stringify({
      title: "Update Rust crate similar to v3",
      author: "app/renovate",
      author_association: "NONE",
      head_ref: "renovate/similar-3.x",
      labels: ["internal", "build:artifacts"],
      comment_count: 0,
      review_count: 0,
    }, null, 2)}\n`,
  );

  const result = await checkIssueTriagePrPolicy({ snapshot: snapshotPath });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /bot_authored_pull_request/);
  assert.match(result.reasons.join(","), /dependency_update_pull_request/);
});

test("checkIssueTriagePrPolicy blocks targets in trust recovery after spam", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-pr-policy-trust-"));
  const snapshotPath = path.join(tempRoot, "snapshot.json");
  const dossierPath = path.join(tempRoot, "astral-sh-uv.md");
  await writeFile(
    snapshotPath,
    `${JSON.stringify({
      title: "docs: clarify resolver fallback behavior",
      author: "outside-dev",
      author_association: "CONTRIBUTOR",
      head_ref: "docs/clarify-fallback",
      labels: ["documentation"],
      comment_count: 1,
      review_count: 0,
    }, null, 2)}\n`,
  );
  await writeFile(
    dossierPath,
    [
      "---",
      "title: Target Dossier — astral-sh/uv",
      "subject_locator: astral-sh/uv",
      "---",
      "",
      "# astral-sh/uv",
      "",
      "## Recent Outcomes",
      "",
      "- 2026-04-16 · `issue-triage` · `spam` · public comment was minimized as spam and should trigger trust recovery.",
      "",
    ].join("\n"),
  );

  const result = await checkIssueTriagePrPolicy({
    snapshot: snapshotPath,
    dossier: dossierPath,
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(","), /comment_lane_in_trust_recovery/);
});

test("checkIssueTriagePrPolicy blocks generated issue-triage operator-memory PRs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-pr-policy-generated-"));
  const snapshotPath = path.join(tempRoot, "snapshot.json");
  await writeFile(
    snapshotPath,
    `${JSON.stringify({
      title: "[runx] update issue-triage operator memory",
      body: "## Summary\n\nGenerated policy body.",
      author: "github-actions[bot]",
      author_association: "MEMBER",
      head_ref: "runx/operator-memory-issue-triage-nilstate-aster-pr-71",
      labels: [],
      comment_count: 0,
      review_count: 0,
    }, null, 2)}\n`,
  );

  const result = await checkIssueTriagePrPolicy({ snapshot: snapshotPath });

  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasons, ["generated_issue_triage_pr"]);
  assert.equal(result.generated_lane, "issue-triage");
});

test("checkIssueTriagePrPolicy blocks generated evidence projection PRs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-pr-policy-projection-"));
  const snapshotPath = path.join(tempRoot, "snapshot.json");
  await writeFile(
    snapshotPath,
    `${JSON.stringify({
      title: "[runx] refresh evidence projections",
      body: "<!-- aster:generated-pr-policy lane=evidence-projection-derive merge=human_review draft_only=true -->\n\n## Summary\n\nDerived evidence projections.",
      author: "github-actions[bot]",
      author_association: "MEMBER",
      head_ref: "runx/evidence-projection-derive",
      labels: [],
      comment_count: 0,
      review_count: 0,
    }, null, 2)}\n`,
  );

  const result = await checkIssueTriagePrPolicy({ snapshot: snapshotPath });

  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasons, ["generated_evidence_projection_pr"]);
  assert.equal(result.generated_lane, "evidence-projection-derive");
});
