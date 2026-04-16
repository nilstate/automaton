import test from "node:test";
import assert from "node:assert/strict";

import {
  collectWorkerValidationIssues,
  normalizeIssueToPrRequest,
  normalizeWorkspaceChangePlanRequest,
  resolveVerificationPlan,
  validateVerificationProfileCatalog,
} from "./automaton-v1-contracts.mjs";

const catalog = validateVerificationProfileCatalog({
  version: "runx.verification_profile_catalog.v1",
  repo_defaults: {
    "nilstate/automaton": "automaton.site-ci",
  },
  profiles: {
    "automaton.site-ci": {
      repo: "nilstate/automaton",
      description: "Run the site CI checks.",
      commands: ["npm run site:ci"],
    },
  },
});

test("normalizeIssueToPrRequest applies the repo default verification profile", () => {
  const request = normalizeIssueToPrRequest(
    {
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
    },
    {
      defaultRepo: "nilstate/automaton",
      catalog,
    },
  );

  assert.equal(request.target_repo, "nilstate/automaton");
  assert.equal(request.verification_profile, "automaton.site-ci");
});

test("normalizeIssueToPrRequest rejects out-of-scope repos", () => {
  assert.throws(() => {
    normalizeIssueToPrRequest(
      {
        issue_title: "Fix docs drift",
        source: "github_issue",
        source_id: "101",
        target_repo: "vercel/next.js",
      },
      { catalog },
    );
  }, /outside prerelease v1 scope/);
});

test("resolveVerificationPlan maps legacy validation commands onto a declared profile", () => {
  const resolved = resolveVerificationPlan({
    catalog,
    targetRepo: "nilstate/automaton",
    issueToPrRequest: {
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
      validation_commands: ["npm run site:ci"],
    },
  });

  assert.equal(resolved.profile_id, "automaton.site-ci");
  assert.equal(resolved.compatibility_mode, "legacy_validation_command_mapping");
  assert.deepEqual(resolved.commands, ["npm run site:ci"]);
});

test("collectWorkerValidationIssues filters invalid worker requests", () => {
  const result = collectWorkerValidationIssues(
    [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: {
          issue_title: "Fix docs drift",
          source: "github_issue",
          source_id: "101",
        },
      },
      {
        worker: "issue-to-pr",
        issue_to_pr_request: {
          issue_title: "Cross-repo mutation",
          source: "github_issue",
          source_id: "102",
          target_repo: "acme/api",
        },
      },
    ],
    {
      defaultRepo: "nilstate/automaton",
      catalog,
    },
  );

  assert.equal(result.accepted.length, 1);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /outside prerelease v1 scope/);
});

test("normalizeWorkspaceChangePlanRequest preserves structured target surfaces", () => {
  const request = normalizeWorkspaceChangePlanRequest(
    {
      objective: "Roll out the docs fix",
      project_context: "automaton workspace",
      target_surfaces: [
        {
          surface: "nilstate/automaton",
          kind: "repo",
          mutating: true,
          rationale: "Single prerelease repo scope.",
        },
      ],
      shared_invariants: ["No external mutation."],
      success_criteria: ["One bounded plan exists before changes start."],
    },
    {
      targetRepo: "nilstate/automaton",
    },
  );

  assert.equal(request.target_surfaces.length, 1);
  assert.equal(request.target_surfaces[0].surface, "nilstate/automaton");
  assert.equal(request.target_surfaces[0].mutating, true);
});
