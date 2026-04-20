import test from "node:test";
import assert from "node:assert/strict";

import { buildReplayGuardPlan } from "./issue-triage-replay-guard.mjs";
import {
  buildIssueTriageComment,
  computeIssueFingerprint,
} from "./issue-triage-markers.mjs";

test("buildReplayGuardPlan skips duplicate issue fingerprints", () => {
  const fingerprint = computeIssueFingerprint({
    title: "docs: fix command",
    body: "Command drift in README.",
  });
  const plan = buildReplayGuardPlan({
    mode: "issue",
    issue: "42",
    title: "docs: fix command",
    body: "Command drift in README.",
    comments: [
      {
        body: buildIssueTriageComment({
          body: "Please narrow this to one command update.",
          fingerprint,
        }),
      },
    ],
  });

  assert.equal(plan.status, "skip");
  assert.equal(plan.reason, "duplicate_issue_fingerprint");
  assert.equal(plan.fingerprint, fingerprint);
});

test("buildReplayGuardPlan skips duplicate PR head shas", () => {
  const plan = buildReplayGuardPlan({
    mode: "pr",
    pr: "18",
    sha: "abc1234",
    comments: [
      {
        body: buildIssueTriageComment({
          body: "This PR needs one bounded validation note.",
          sha: "abc1234",
        }),
      },
    ],
  });

  assert.equal(plan.status, "skip");
  assert.equal(plan.reason, "duplicate_pr_head_sha");
});
