import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { deriveEvidenceProjections } from "./derive-evidence-projections.mjs";

test("deriveEvidenceProjections applies new artifact-backed promotion summaries and tracks them in state", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-evidence-projections-"));
  const repoRoot = path.join(tempRoot, "repo");
  const statePath = path.join(repoRoot, "state", "evidence-projections.json");
  await mkdir(path.join(repoRoot, "state"), { recursive: true });

  await writeFile(
    statePath,
    `${JSON.stringify({
      generated_at: "2026-04-19T00:00:00Z",
      source: {
        type: "github_actions_artifacts",
        repo: "nilstate/aster",
        artifact_prefixes: ["issue-triage-", "skill-lab-"],
        artifact_limit: 200,
      },
      stats: {
        tracked_artifacts: 1,
        newly_processed_artifacts: 0,
        applied_summaries: 0,
        skipped_artifacts: 0,
        errors: 0,
      },
      artifacts: [
        {
          artifact_id: 100,
          name: "issue-triage-issue-10",
          created_at: "2026-04-19T00:00:00Z",
          updated_at: "2026-04-19T00:05:00Z",
          workflow_run_id: 9000,
          summaries: [],
        },
      ],
    }, null, 2)}\n`,
  );

  const report = await deriveEvidenceProjections(
    {
      repoRoot,
      repo: "nilstate/aster",
      output: statePath,
      downloadRoot: path.join(tempRoot, "downloads"),
      now: "2026-04-20T08:30:00Z",
    },
    {
      listArtifacts: async () => ([
        {
          id: 100,
          name: "issue-triage-issue-10",
          created_at: "2026-04-19T00:00:00Z",
          updated_at: "2026-04-19T00:05:00Z",
          expired: false,
          workflow_run: { id: 9000, head_branch: "main", head_sha: "aaa111" },
        },
        {
          id: 101,
          name: "issue-triage-pr-11",
          created_at: "2026-04-20T01:00:00Z",
          updated_at: "2026-04-20T01:05:00Z",
          expired: false,
          workflow_run: { id: 9001, head_branch: "main", head_sha: "bbb222" },
        },
        {
          id: 102,
          name: "skill-lab-12",
          created_at: "2026-04-20T02:00:00Z",
          updated_at: "2026-04-20T02:05:00Z",
          expired: false,
          workflow_run: { id: 9002, head_branch: "main", head_sha: "ccc333" },
        },
      ]),
      downloadArtifact: async ({ artifact, outputDir }) => {
        if (artifact.id === 102) {
          await writeFile(path.join(outputDir, "README.txt"), "no summary here\n");
          return;
        }
        const promotionsDir = path.join(outputDir, "promotions");
        await mkdir(promotionsDir, { recursive: true });
        const reflectionPath = path.join(promotionsDir, "2026-04-20-issue-triage-nilstate-runx-pr-11.md");
        const historyPath = path.join(promotionsDir, "history-2026-04-20-issue-triage-nilstate-runx-pr-11.md");
        const packetPath = path.join(promotionsDir, "2026-04-20-issue-triage-nilstate-runx-pr-11.json");
        await writeFile(reflectionPath, "# Reflection\n");
        await writeFile(historyPath, "# History\n");
        await writeFile(
          packetPath,
          `${JSON.stringify({
            created_at: "2026-04-20T01:00:00Z",
            lane: "issue-triage",
            status: "success",
            receipt_id: "rcpt_101",
            summary: "clarified PR routing",
            subject: {
              locator: "nilstate/runx#pr/11",
              target_repo: "nilstate/runx",
            },
          }, null, 2)}\n`,
        );
        await writeFile(
          path.join(outputDir, "core-summary.json"),
          `${JSON.stringify({
            lane: "issue-triage",
            promotion_outputs: {
              reflection_path: "/home/runner/work/aster/aster/.artifacts/issue-triage/pr/promotions/2026-04-20-issue-triage-nilstate-runx-pr-11.md",
              history_path: "/home/runner/work/aster/aster/.artifacts/issue-triage/pr/promotions/history-2026-04-20-issue-triage-nilstate-runx-pr-11.md",
              packet_path: "/home/runner/work/aster/aster/.artifacts/issue-triage/pr/promotions/2026-04-20-issue-triage-nilstate-runx-pr-11.json",
            },
          }, null, 2)}\n`,
        );
      },
    },
  );

  const dossier = await readFile(path.join(repoRoot, "state", "targets", "nilstate-runx.md"), "utf8");
  const reflection = await readFile(path.join(repoRoot, "reflections", "2026-04-20-issue-triage-nilstate-runx-pr-11.md"), "utf8");
  const history = await readFile(path.join(repoRoot, "history", "2026-04-20-issue-triage-nilstate-runx-pr-11.md"), "utf8");

  assert.equal(report.candidate_artifacts, 2);
  assert.equal(report.applied.length, 1);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "no_core_summary");
  assert.equal(report.state.stats.tracked_artifacts, 2);
  assert.equal(report.state.artifacts[1].artifact_id, 101);
  assert.match(dossier, /## Recent Outcomes/);
  assert.match(dossier, /rcpt_101/);
  assert.match(dossier, /clarified PR routing/);
  assert.match(reflection, /# Reflection/);
  assert.match(history, /# History/);
});
