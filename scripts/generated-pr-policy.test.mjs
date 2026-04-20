import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGeneratedPrPolicyPlan,
  ensureGeneratedPrPolicyBlock,
  inferGeneratedPrLane,
  parseGeneratedPrPolicy,
} from "./generated-pr-policy.mjs";

test("ensureGeneratedPrPolicyBlock appends a policy block", () => {
  const body = ensureGeneratedPrPolicyBlock("## Summary\n\nBounded change.", {
    lane: "issue-triage",
    changeSurfacePolicy: {
      status: "allowed",
      internal_repo: true,
      surfaces: ["learned_state", "public_history", "reflections"],
      reasons: [],
    },
  });

  const parsed = parseGeneratedPrPolicy(body);
  assert.equal(parsed?.lane, "issue-triage");
  assert.match(body, /## Generated PR Policy/);
  assert.match(body, /## Change Surface Policy/);
  assert.match(body, /`learned_state`/);
});

test("inferGeneratedPrLane derives the lane from branch naming", () => {
  assert.equal(
    inferGeneratedPrLane({
      headRefName: "runx/operator-memory-issue-triage-nilstate-aster-issue-9",
      title: "[runx] update issue-triage operator memory",
      body: "",
    }),
    "issue-triage",
  );
  assert.equal(
    inferGeneratedPrLane({
      headRefName: "runx/evidence-projection-derive",
      title: "[runx] refresh evidence projections",
      body: "",
    }),
    "evidence-projection-derive",
  );
});

test("buildGeneratedPrPolicyPlan enforces body patching and draft mode", () => {
  const plan = buildGeneratedPrPolicyPlan({
    headRefName: "runx/skill-88",
    title: "[runx] skill proposal #88",
    body: "## Summary\n\nSkill proposal body.",
    isDraft: false,
  });

  assert.equal(plan.status, "enforce");
  assert.deepEqual(plan.actions, ["patch_body", "convert_to_draft"]);
  assert.match(plan.next_body, /Generated PR Policy/);
});
