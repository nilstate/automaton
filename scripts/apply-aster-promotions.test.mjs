import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  applyAsterPromotions,
  assertManagedPromotionTarget,
  resolvePromotionOutputs,
  upsertFrontmatterField,
  upsertRecentOutcomesSection,
} from "./apply-aster-promotions.mjs";

test("upsertRecentOutcomesSection prepends and dedupes recent outcomes", () => {
  const initial = "# Target\n\n## Why It Matters\n\ntext\n";
  const once = upsertRecentOutcomesSection(initial, "- 2026-04-16 · `lane` · `completed` · `rcpt_123` · summary");
  const twice = upsertRecentOutcomesSection(once, "- 2026-04-16 · `lane` · `completed` · `rcpt_123` · summary");

  assert.match(once, /## Recent Outcomes/);
  assert.equal((twice.match(/summary/g) ?? []).length, 1);
});

test("upsertFrontmatterField updates existing frontmatter values", () => {
  const updated = upsertFrontmatterField(
    ["---", "title: Target", "updated: 2026-04-16", "---", "", "# Target"].join("\n"),
    "updated",
    "2026-04-17",
  );

  assert.match(updated, /updated: 2026-04-17/);
});

test("assertManagedPromotionTarget rejects doctrine writes", () => {
  assert.throws(
    () => assertManagedPromotionTarget("/tmp/repo", "/tmp/repo/doctrine/VOICE.md"),
    /may not write into doctrine/i,
  );
});

test("applyAsterPromotions copies drafts and updates target dossier", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-promotions-"));
  const repoRoot = path.join(tempRoot, "repo");
  const artifactRoot = path.join(tempRoot, "artifacts");
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const reflectionPath = path.join(artifactRoot, "reflection.md");
  const historyPath = path.join(artifactRoot, "history-entry.md");
  const packetPath = path.join(artifactRoot, "packet.json");
  const summaryPath = path.join(artifactRoot, "summary.json");

  await writeFile(reflectionPath, "# Reflection\n");
  await writeFile(historyPath, "# History\n");
  await writeFile(
    packetPath,
    `${JSON.stringify(
      {
        created_at: "2026-04-16T00:00:00Z",
        lane: "issue-triage",
        status: "completed",
        receipt_id: "rcpt_123",
        summary: "README command drift",
        subject: {
          target_repo: "nilstate/aster",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        promotion_outputs: {
          reflection_path: reflectionPath,
          history_path: historyPath,
          packet_path: packetPath,
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await applyAsterPromotions({
    repoRoot,
    summary: summaryPath,
  });

  const dossier = await readFile(path.join(repoRoot, "state", "targets", "nilstate-aster.md"), "utf8");
  assert.equal(result.status, "applied");
  assert.match(dossier, /updated: 2026-04-16/);
  assert.match(dossier, /## Recent Outcomes/);
  assert.match(dossier, /rcpt_123/);
  assert.match(dossier, /README command drift/);
  assert.match(await readFile(path.join(repoRoot, "reflections", "reflection.md"), "utf8"), /# Reflection/);
  assert.match(await readFile(path.join(repoRoot, "history", "entry.md"), "utf8"), /# History/);
});

test("resolvePromotionOutputs falls back to artifact-local promotion files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-promotion-resolve-"));
  const summaryPath = path.join(tempRoot, "core-summary.json");
  const promotionsDir = path.join(tempRoot, "promotions");
  await mkdir(promotionsDir, { recursive: true });

  const reflectionPath = path.join(promotionsDir, "reflection.md");
  const historyPath = path.join(promotionsDir, "history-entry.md");
  const packetPath = path.join(promotionsDir, "packet.json");
  await writeFile(reflectionPath, "# Reflection\n");
  await writeFile(historyPath, "# History\n");
  await writeFile(packetPath, "{}\n");

  const outputs = resolvePromotionOutputs(
    {
      reflection_path: "/home/runner/work/aster/aster/.artifacts/issue-triage/issue/promotions/reflection.md",
      history_path: "/home/runner/work/aster/aster/.artifacts/issue-triage/issue/promotions/history-entry.md",
      packet_path: "/home/runner/work/aster/aster/.artifacts/issue-triage/issue/promotions/packet.json",
    },
    summaryPath,
  );

  assert.equal(outputs.reflection_path, reflectionPath);
  assert.equal(outputs.history_path, historyPath);
  assert.equal(outputs.packet_path, packetPath);
});
