import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { slugifyRepoLike } from "./build-aster-context.mjs";

const managedPromotionRoots = [
  "reflections",
  "history",
  path.join("state", "targets"),
];

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await applyAsterPromotions(options);

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function applyAsterPromotions(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const summaryPath = path.resolve(options.summary);
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const promotionOutputs = resolvePromotionOutputs(summary?.promotion_outputs, summaryPath);
  const packet = JSON.parse(await readFile(promotionOutputs.packet_path, "utf8"));

  const reflectionSource = promotionOutputs.reflection_path;
  const historySource = promotionOutputs.history_path;
  const reflectionTarget = path.join(repoRoot, "reflections", path.basename(reflectionSource));
  const historyTarget = path.join(
    repoRoot,
    "history",
    path.basename(historySource).replace(/^history-/, ""),
  );
  assertManagedPromotionTarget(repoRoot, reflectionTarget);
  assertManagedPromotionTarget(repoRoot, historyTarget);

  await mkdir(path.dirname(reflectionTarget), { recursive: true });
  await mkdir(path.dirname(historyTarget), { recursive: true });
  await copyIfChanged(reflectionSource, reflectionTarget);
  await copyIfChanged(historySource, historyTarget);

  const targetRepo = firstString(packet?.subject?.target_repo)
    || firstString(packet?.subject?.repo)
    || "nilstate/aster";
  const targetSlug = slugifyRepoLike(targetRepo);
  const targetDossierPath = path.join(repoRoot, "state", "targets", `${targetSlug}.md`);
  assertManagedPromotionTarget(repoRoot, targetDossierPath);
  const targetUpdated = await updateTargetRecentOutcomes({
    dossierPath: targetDossierPath,
    packet,
  });

  return {
    status: "applied",
    reflection_path: reflectionTarget,
    history_path: historyTarget,
    target_dossier_path: targetDossierPath,
    target_updated: targetUpdated,
  };
}

export function resolvePromotionOutputs(outputs, summaryPath) {
  const resolvedSummaryPath = path.resolve(summaryPath);
  return {
    reflection_path: resolvePromotionPath(outputs?.reflection_path, resolvedSummaryPath),
    history_path: resolvePromotionPath(outputs?.history_path, resolvedSummaryPath),
    packet_path: resolvePromotionPath(outputs?.packet_path, resolvedSummaryPath),
  };
}

function resolvePromotionPath(rawPath, summaryPath) {
  const normalized = typeof rawPath === "string" && rawPath.trim().length > 0
    ? rawPath.trim()
    : null;
  if (!normalized) {
    throw new Error(`promotion output missing required path in ${summaryPath}`);
  }

  const summaryDir = path.dirname(summaryPath);
  const candidates = [
    path.resolve(normalized),
    path.join(summaryDir, "promotions", path.basename(normalized)),
    path.join(summaryDir, path.basename(normalized)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

async function copyIfChanged(source, target) {
  const sourceContent = await readFile(source, "utf8");
  let targetContent = "";
  try {
    targetContent = await readFile(target, "utf8");
  } catch {
    targetContent = "";
  }

  if (sourceContent === targetContent) {
    return false;
  }

  await copyFile(source, target);
  return true;
}

export function assertManagedPromotionTarget(repoRoot, targetPath) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`promotion target escapes repo root: ${targetPath}`);
  }
  const normalized = relative.replaceAll(path.sep, "/");
  if (normalized === "doctrine" || normalized.startsWith("doctrine/")) {
    throw new Error(`promotion target may not write into doctrine/: ${normalized}`);
  }
  const allowed = managedPromotionRoots.some((root) => {
    const normalizedRoot = root.replaceAll(path.sep, "/");
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
  if (!allowed) {
    throw new Error(`promotion target outside managed roots: ${normalized}`);
  }
}

async function updateTargetRecentOutcomes({ dossierPath, packet }) {
  let content = "";
  try {
    content = await readFile(dossierPath, "utf8");
  } catch {
    content = createTargetDossier(packet);
  }

  const outcomeLine = buildOutcomeLine(packet);
  const next = upsertFrontmatterField(
    upsertRecentOutcomesSection(content, outcomeLine),
    "updated",
    firstString(packet?.created_at).slice(0, 10) || new Date().toISOString().slice(0, 10),
  );
  if (next === content) {
    return false;
  }

  await mkdir(path.dirname(dossierPath), { recursive: true });
  await writeFile(dossierPath, next);
  return true;
}

function createTargetDossier(packet) {
  const targetRepo = firstString(packet?.subject?.target_repo)
    || firstString(packet?.subject?.repo)
    || "unknown/target";
  return `${[
    "---",
    `title: Target Dossier — ${targetRepo}`,
    `updated: ${packet?.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}`,
    "visibility: public",
    "subject_kind: github_repository",
    `subject_locator: ${targetRepo}`,
    "---",
    "",
    `# ${targetRepo}`,
    "",
    "## Why It Matters",
    "",
    "Target dossier created from operator promotion output.",
    "",
  ].join("\n")}\n`;
}

export function upsertRecentOutcomesSection(content, outcomeLine) {
  const heading = "## Recent Outcomes";
  const sectionMatch = content.match(/## Recent Outcomes\n([\s\S]*?)(?=\n## |\s*$)/);
  const existingLines = sectionMatch
    ? sectionMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const deduped = [outcomeLine, ...existingLines.filter((line) => line !== outcomeLine)].slice(0, 5);
  const section = `${heading}\n\n${deduped.join("\n")}\n`;

  if (sectionMatch) {
    return content.replace(sectionMatch[0], section.trimEnd());
  }

  const trimmed = content.trimEnd();
  return `${trimmed}\n\n${section}`;
}

export function upsertFrontmatterField(content, key, value) {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return content;
  }
  const block = content.slice(4, end).split("\n");
  let found = false;
  const nextBlock = block.map((line) => {
    if (!line.startsWith(`${key}:`)) {
      return line;
    }
    found = true;
    return `${key}: ${value}`;
  });
  if (!found) {
    nextBlock.push(`${key}: ${value}`);
  }
  return `---\n${nextBlock.join("\n")}\n---\n${content.slice(end + 5)}`;
}

function buildOutcomeLine(packet) {
  const date = firstString(packet?.created_at).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const lane = firstString(packet?.lane) || "unknown-lane";
  const status = firstString(packet?.status) || "unknown";
  const receiptId = firstString(packet?.receipt_id);
  const summary = firstString(packet?.summary) || "operator run completed";
  const parts = [`- ${date}`, `\`${lane}\``, `\`${status}\``];
  if (receiptId) {
    parts.push(`\`${receiptId}\``);
  }
  return `${parts.join(" · ")} · ${summary}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--summary") {
      options.summary = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.summary || !options.repoRoot) {
    throw new Error("--summary and --repo-root are required.");
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
