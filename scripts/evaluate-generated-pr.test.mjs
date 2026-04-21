import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGeneratedPr } from "./evaluate-generated-pr.mjs";
import { ensureGeneratedPrPolicyBlock } from "./generated-pr-policy.mjs";

test("evaluateGeneratedPr passes a published PR with policy and validation", () => {
  const evaluation = evaluateGeneratedPr({
    publish: {
      status: "published",
      policy: { lane: "issue-triage" },
      change_summary: {
        file_count: 2,
        additions: 12,
        deletions: 3,
      },
      change_surface_policy: {
        status: "allowed",
      },
    },
    body: ensureGeneratedPrPolicyBlock("## Summary\n\nBounded PR body.", {
      lane: "issue-triage",
    }),
    validation: {
      verification_profile: "docs",
      commands: ["npm test"],
    },
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.policy_present, true);
  assert.equal(evaluation.checks.change_surface_policy_recorded, true);
});

test("evaluateGeneratedPr flags missing policy blocks", () => {
  const evaluation = evaluateGeneratedPr({
    publish: {
      status: "published",
      change_summary: {
        file_count: 1,
        additions: 4,
        deletions: 0,
      },
      change_surface_policy: null,
    },
    body: "## Summary\n\nNo policy block here.",
    validation: {},
  });

  assert.equal(evaluation.status, "needs_review");
  assert.equal(evaluation.checks.policy_present, false);
});

test("evaluateGeneratedPr normalizes final published policy from metadata", () => {
  const evaluation = evaluateGeneratedPr({
    publish: {
      status: "published",
      policy: { lane: "skill-lab" },
      change_summary: {
        file_count: 2,
        additions: 8,
        deletions: 0,
      },
      change_surface_policy: {
        status: "allowed",
        internal_repo: true,
        surfaces: ["working_docs"],
        reasons: [],
      },
    },
    body: "## Summary\n\nDraft proposal.\n\n## Validation\n\n- receipts uploaded with this workflow run",
    validation: {
      commands: ["npm run docs:ci"],
    },
  });

  assert.equal(evaluation.status, "pass");
  assert.equal(evaluation.checks.policy_present, true);
  assert.equal(evaluation.checks.draft_only_policy, true);
});
