import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyRepoPath,
  evaluateLaneChangeSurfacePolicy,
  summarizeChangeSurfaces,
} from "./change-surface-governance.mjs";

test("classifyRepoPath separates constitutional, learned, and public surfaces", () => {
  assert.equal(classifyRepoPath("doctrine/VOICE.md"), "doctrine");
  assert.equal(classifyRepoPath("state/targets/nilstate-aster.md"), "learned_state");
  assert.equal(classifyRepoPath("history/2026-04-17-entry.md"), "public_history");
  assert.equal(classifyRepoPath("reflections/2026-04-17-note.md"), "reflections");
  assert.equal(classifyRepoPath("site/src/pages/index.astro"), "public_face");
  assert.equal(classifyRepoPath("docs/run-catalog.md"), "working_docs");
  assert.equal(classifyRepoPath("scripts/aster-core.mjs"), "automation_runtime");
  assert.equal(classifyRepoPath("README.md"), "repo_meta");
});

test("summarizeChangeSurfaces groups files by surface", () => {
  const summary = summarizeChangeSurfaces([
    "doctrine/ASTER.md",
    "state/priorities.md",
    "site/src/pages/index.astro",
  ]);

  assert.deepEqual(summary.surfaces, ["doctrine", "learned_state", "public_face"]);
  assert.equal(summary.surface_counts.doctrine, 1);
  assert.equal(summary.files_by_surface.learned_state[0], "state/priorities.md");
});

test("evaluateLaneChangeSurfacePolicy blocks doctrine and learned-state writes for docs-pr", () => {
  const policy = evaluateLaneChangeSurfacePolicy({
    lane: "docs-pr",
    repo: "nilstate/aster",
    ownerRepo: "nilstate/aster",
    files: [
      "docs/architecture.md",
      "doctrine/AUTHORITY.md",
      "state/priorities.md",
    ],
  });

  assert.equal(policy.status, "blocked");
  assert.match(policy.reasons.join(","), /doctrine_surface_requires_human_review/);
  assert.match(policy.reasons.join(","), /surface_not_allowed:doctrine/);
  assert.match(policy.reasons.join(","), /surface_not_allowed:learned_state/);
});

test("evaluateLaneChangeSurfacePolicy allows issue-triage promotion surfaces", () => {
  const policy = evaluateLaneChangeSurfacePolicy({
    lane: "issue-triage",
    repo: "nilstate/aster",
    ownerRepo: "nilstate/aster",
    files: [
      "state/targets/nilstate-aster.md",
      "history/2026-04-17-entry.md",
      "reflections/2026-04-17-reflection.md",
    ],
  });

  assert.equal(policy.status, "allowed");
  assert.deepEqual(policy.blocked_surfaces, []);
});

test("evaluateLaneChangeSurfacePolicy allows evidence-projection-derive surfaces", () => {
  const policy = evaluateLaneChangeSurfacePolicy({
    lane: "evidence-projection-derive",
    repo: "nilstate/aster",
    ownerRepo: "nilstate/aster",
    files: [
      "state/evidence-projections.json",
      "state/targets/nilstate-aster.md",
      "history/2026-04-17-entry.md",
      "reflections/2026-04-17-reflection.md",
      "README.md",
    ],
  });

  assert.equal(policy.status, "allowed");
  assert.deepEqual(policy.blocked_surfaces, []);
});

test("evaluateLaneChangeSurfacePolicy allows thread-teaching-derive to refresh learned state only", () => {
  const policy = evaluateLaneChangeSurfacePolicy({
    lane: "thread-teaching-derive",
    repo: "nilstate/aster",
    ownerRepo: "nilstate/aster",
    files: [
      "state/thread-teaching.json",
      "README.md",
    ],
  });

  assert.equal(policy.status, "allowed");
  assert.deepEqual(policy.blocked_surfaces, []);
});

test("evaluateLaneChangeSurfacePolicy reports only for external repos", () => {
  const policy = evaluateLaneChangeSurfacePolicy({
    lane: "fix-pr",
    repo: "vercel/next.js",
    ownerRepo: "nilstate/aster",
    files: ["docs/app-router.md", "src/app.ts"],
  });

  assert.equal(policy.status, "report_only");
  assert.equal(policy.internal_repo, false);
});
