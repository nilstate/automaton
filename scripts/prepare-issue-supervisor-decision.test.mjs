import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareIssueSupervisorDecision } from "./prepare-issue-supervisor-decision.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("prepareIssueSupervisorDecision starts an issue-to-pr worker only after triage approves build", () => {
  const decision = prepareIssueSupervisorDecision({
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          category: "bug",
          severity: "medium",
          summary: "README command drift",
          suggested_reply: "This is bounded enough for one draft PR.",
          recommended_lane: "issue-to-pr",
          rationale: "One repo, one low-risk change.",
          needs_human: false,
          commence_decision: "approve",
          action_decision: "proceed_to_build",
          operator_notes: [],
          issue_to_pr_request: {
            task_id: "issue-101",
            issue_title: "README still references bug-to-pr",
            issue_body: "Use issue-to-pr instead.",
            source: "github_issue",
            source_id: "101",
            source_url: "https://github.com/example/repo/issues/101",
            size: "micro",
            risk: "low",
          },
        },
      }),
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.mode, "issue-to-pr");
  assert.equal(decision.supervisor_decision.should_start_worker, true);
  assert.equal(decision.supervisor_decision.worker_requests.length, 1);
  assert.equal(decision.issue_to_pr_request.target_repo, "nilstate/automaton");
  assert.equal(decision.issue_to_pr_request.verification_profile, "automaton.site-ci");
  assert.match(decision.comment_body, /Commence: `approve`/);
  assert.match(decision.comment_body, /This is bounded enough for one draft PR\./);
  assert.match(decision.comment_body, /Worker fanout: `1`/);
});

test("prepareIssueSupervisorDecision derives a single worker request when triage omits issue_to_pr_request", () => {
  const decision = prepareIssueSupervisorDecision({
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          category: "bug",
          severity: "medium",
          summary: "README command drift",
          suggested_reply: "This is bounded enough for one draft PR.",
          recommended_lane: "issue-to-pr",
          rationale: "One repo, one low-risk change.",
          needs_human: false,
          commence_decision: "approve",
          action_decision: "proceed_to_build",
          operator_notes: [],
        },
        change_set: {
          change_set_id: "change-set-101",
          source: {
            type: "github_issue",
            id: "101",
            url: "https://github.com/example/repo/issues/101",
          },
          summary: "README still references bug-to-pr",
        },
      }),
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.mode, "issue-to-pr");
  assert.equal(decision.supervisor_decision.should_start_worker, true);
  assert.equal(decision.supervisor_decision.worker_requests.length, 1);
  assert.equal(decision.issue_to_pr_request.task_id, "issue-101");
  assert.equal(decision.issue_to_pr_request.issue_title, "README command drift");
  assert.equal(decision.issue_to_pr_request.source_id, "101");
  assert.equal(decision.issue_to_pr_request.target_repo, "nilstate/automaton");
  assert.equal(decision.issue_to_pr_request.verification_profile, "automaton.site-ci");
});

test("prepareIssueSupervisorDecision holds at a review comment when mutation should not start yet", () => {
  const decision = prepareIssueSupervisorDecision({
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          category: "feature_request",
          severity: "medium",
          summary: "Cross-repo abandoned cart recovery",
          suggested_reply: "This needs planning before a build lane starts.",
          recommended_lane: "objective-decompose",
          rationale: "The request spans multiple repo-scoped deliverables.",
          needs_human: true,
          commence_decision: "approve",
          action_decision: "request_review",
          review_target: "issue",
          review_comment: "runx is holding mutation until the scope is decomposed.",
          operator_notes: ["Confirm the first target repo before any worker starts."],
          objective_request: {
            objective: "Add abandoned cart recovery",
            project_context: "Workspace repo",
          },
        },
      }),
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.mode, "comment");
  assert.equal(decision.supervisor_decision.should_start_worker, false);
  assert.equal(decision.supervisor_decision.review_target, "issue");
  assert.equal(decision.supervisor_decision.comment_target, "issue");
  assert.match(decision.comment_body, /runx is holding mutation until the scope is decomposed\./);
  assert.match(decision.comment_body, /Operator notes:/);
});

test("prepareIssueSupervisorDecision falls back to an issue comment when draft PR review is requested before publish", () => {
  const decision = prepareIssueSupervisorDecision({
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          category: "docs",
          severity: "medium",
          summary: "Need maintainer confirmation before opening a worker.",
          suggested_reply: "Please confirm whether this should land as a docs-only fix.",
          recommended_lane: "manual-triage",
          rationale: "The target surface is still unclear.",
          needs_human: false,
          commence_decision: "approve",
          action_decision: "request_review",
          review_target: "draft_pr",
          review_comment: "Please confirm the exact repo before runx opens a worker.",
          operator_notes: [],
        },
      }),
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.supervisor_decision.review_target, "draft_pr");
  assert.equal(decision.supervisor_decision.comment_target, "issue");
  assert.match(decision.comment_body, /Comment surface: `issue`/);
  assert.match(decision.comment_body, /no draft PR exists yet/i);
});

test("prepareIssueSupervisorDecision starts a planning lane for objective-decompose before any worker starts", () => {
  const decision = prepareIssueSupervisorDecision({
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          category: "feature_request",
          severity: "high",
          summary: "Abandoned cart recovery spans api and app.",
          suggested_reply: "runx is opening a shared planning lane before any repo worker starts.",
          recommended_lane: "objective-decompose",
          rationale: "The work crosses repo boundaries and needs one frozen plan first.",
          needs_human: false,
          commence_decision: "approve",
          action_decision: "proceed_to_plan",
          operator_notes: ["Freeze the backend-facing contract before downstream repo workers run."],
          workspace_change_plan_request: {
            change_set_id: "change-set-204",
            objective: "Roll out abandoned cart recovery",
            project_context: "automaton workspace repo",
            target_surfaces: [
              { surface: "automaton/api", kind: "repo", mutating: true, rationale: "Backend semantics change first." },
              { surface: "automaton/app", kind: "repo", mutating: true, rationale: "The UI must consume the frozen contract." },
            ],
            shared_invariants: ["Keep the rollout approval-gated."],
            success_criteria: ["One phased plan exists before mutation begins."],
          },
        },
        change_set: {
          change_set_id: "change-set-204",
          source: { type: "github_issue", id: "204" },
          summary: "Roll out abandoned cart recovery.",
          category: "feature_request",
          severity: "high",
          recommended_lane: "objective-decompose",
          commence_decision: "approve",
          action_decision: "proceed_to_plan",
          target_surfaces: [
            { surface: "automaton/api", kind: "repo", mutating: true, rationale: "Backend semantics change first." },
            { surface: "automaton/app", kind: "repo", mutating: true, rationale: "The UI must consume the frozen contract." },
          ],
          shared_invariants: ["Keep the rollout approval-gated."],
          success_criteria: ["One phased plan exists before mutation begins."],
        },
      }),
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.mode, "plan");
  assert.equal(decision.supervisor_decision.should_start_planner, true);
  assert.equal(decision.supervisor_decision.should_start_worker, false);
  assert.equal(decision.workspace_change_plan_request.change_set_id, "change-set-204");
  assert.match(decision.comment_body, /Planning lane: `objective-decompose`/);
});

test("prepareIssueSupervisorDecision stops non-mutating reply-only requests without inventing a worker", () => {
  const decision = prepareIssueSupervisorDecision({
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          category: "question",
          severity: "low",
          summary: "Operator guidance only",
          suggested_reply: "Share the documented API key rotation steps.",
          recommended_lane: "reply-only",
          rationale: "No code change is required.",
          needs_human: false,
        },
      }),
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.mode, "comment");
  assert.equal(decision.supervisor_decision.action_decision, "stop");
  assert.equal(decision.supervisor_decision.should_start_worker, false);
  assert.match(decision.comment_body, /Share the documented API key rotation steps\./);
});

test("prepareIssueSupervisorDecision blocks out-of-scope worker fanout during prerelease v1", () => {
  const decision = prepareIssueSupervisorDecision({
    triage_report: {
      category: "bug",
      severity: "high",
      summary: "Cross-repo drift",
      suggested_reply: "runx is opening one bounded worker per target repo.",
      recommended_lane: "multi-repo-issue-to-pr",
      rationale: "The issue has two independent repo-scoped fixes.",
      commence_decision: "approve",
      action_decision: "proceed_to_build",
      issue_to_pr_requests: [
        {
          task_id: "issue-202-api",
          issue_title: "Fix api receipt wording",
          issue_body: "Update API copy.",
          target_repo: "acme/api",
          source: "github_issue",
          source_id: "202",
          source_url: "https://github.com/example/repo/issues/202",
          size: "micro",
          risk: "low",
        },
        {
          task_id: "issue-202-app",
          issue_title: "Fix app wording",
          issue_body: "Update UI copy.",
          target_repo: "acme/app",
          source: "github_issue",
          source_id: "202",
          source_url: "https://github.com/example/repo/issues/202",
          size: "micro",
          risk: "low",
        },
      ],
    },
  }, { defaultRepo: "nilstate/automaton", repoRoot });

  assert.equal(decision.mode, "comment");
  assert.equal(decision.supervisor_decision.should_start_worker, false);
  assert.equal(decision.supervisor_decision.worker_requests.length, 0);
  assert.match(decision.comment_body, /Boundary notes:/);
  assert.match(decision.comment_body, /outside prerelease v1 scope/);
});
