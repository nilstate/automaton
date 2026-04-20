import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyAsterPromotions, resolvePromotionOutputs } from "./apply-aster-promotions.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");
const defaultArtifactPrefixes = ["issue-triage-", "skill-lab-"];

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await deriveEvidenceProjections(options);
  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(report.state, null, 2)}\n`);
  }
  if (options.reportOutput) {
    await writeFile(path.resolve(options.reportOutput), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export async function deriveEvidenceProjections(options = {}, helpers = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const repo = String(options.repo ?? process.env.GITHUB_REPOSITORY ?? "nilstate/aster");
  const statePath = path.resolve(options.output ?? path.join(repoRoot, "state", "evidence-projections.json"));
  const downloadRoot = path.resolve(
    options.downloadRoot ?? path.join(repoRoot, ".artifacts", "evidence-projection-derive", "downloads"),
  );
  const artifactPrefixes = uniqueStrings(options.artifactPrefixes ?? defaultArtifactPrefixes);
  const limit = Number(options.limit ?? 200);
  const generatedAt = options.now ?? new Date().toISOString();
  const currentState = await readProjectionState(statePath, {
    repo,
    artifactPrefixes,
    generatedAt,
  });
  const processedArtifactIds = new Set(
    normalizeCollection(currentState.artifacts).map((entry) => Number(entry?.artifact_id)).filter(Number.isFinite),
  );

  const listArtifacts = helpers.listArtifacts ?? defaultListArtifacts;
  const downloadArtifact = helpers.downloadArtifact ?? defaultDownloadArtifact;
  const findSummaryFiles = helpers.findSummaryFiles ?? defaultFindSummaryFiles;

  await mkdir(downloadRoot, { recursive: true });

  const listedArtifacts = normalizeCollection(await listArtifacts({ repo, limit }));
  const candidates = listedArtifacts
    .filter((artifact) => matchesArtifactPrefix(artifact?.name, artifactPrefixes))
    .filter((artifact) => !artifact?.expired)
    .filter((artifact) => !processedArtifactIds.has(Number(artifact?.id)))
    .sort(compareArtifactsByCreation);

  const applied = [];
  const skipped = [];
  const errors = [];
  const processedArtifacts = [];

  for (const artifact of candidates) {
    const unpackDir = path.join(downloadRoot, String(artifact.id));
    await rm(unpackDir, { recursive: true, force: true });
    await mkdir(unpackDir, { recursive: true });

    try {
      await downloadArtifact({
        repo,
        artifact,
        outputDir: unpackDir,
      });
      const summaryFiles = await findSummaryFiles(unpackDir);
      if (summaryFiles.length === 0) {
        skipped.push({
          artifact_id: Number(artifact.id),
          name: String(artifact.name ?? ""),
          reason: "no_core_summary",
        });
        continue;
      }

      const artifactSummaries = [];
      let failed = false;
      for (const summaryPath of summaryFiles.sort()) {
        try {
          const summary = JSON.parse(await readFile(summaryPath, "utf8"));
          const promotionOutputs = resolvePromotionOutputs(summary?.promotion_outputs, summaryPath);
          const packet = JSON.parse(await readFile(promotionOutputs.packet_path, "utf8"));
          const result = await applyAsterPromotions({
            repoRoot,
            summary: summaryPath,
          });
          const appliedSummary = buildAppliedSummaryRecord({
            repoRoot,
            artifact,
            packet,
            result,
          });
          artifactSummaries.push(appliedSummary);
          applied.push(appliedSummary);
        } catch (error) {
          failed = true;
          errors.push({
            artifact_id: Number(artifact.id),
            name: String(artifact.name ?? ""),
            summary_path: path.relative(unpackDir, summaryPath).replaceAll(path.sep, "/"),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!failed) {
        processedArtifacts.push(buildProcessedArtifactRecord(artifact, artifactSummaries));
      }
    } catch (error) {
      errors.push({
        artifact_id: Number(artifact.id),
        name: String(artifact.name ?? ""),
        summary_path: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const stateArtifacts = [...normalizeCollection(currentState.artifacts), ...processedArtifacts]
    .sort(compareStateArtifactsByCreation);

  const state = {
    generated_at: generatedAt,
    source: {
      type: "github_actions_artifacts",
      repo,
      artifact_prefixes: artifactPrefixes,
      artifact_limit: limit,
    },
    stats: {
      tracked_artifacts: stateArtifacts.length,
      newly_processed_artifacts: processedArtifacts.length,
      applied_summaries: applied.length,
      skipped_artifacts: skipped.length,
      errors: errors.length,
    },
    artifacts: stateArtifacts,
  };

  return {
    generated_at: generatedAt,
    repo,
    scanned_artifacts: listedArtifacts.length,
    candidate_artifacts: candidates.length,
    applied,
    skipped,
    errors,
    state,
  };
}

async function readProjectionState(filePath, fallback) {
  if (!existsSync(filePath)) {
    return {
      generated_at: fallback.generatedAt,
      source: {
        type: "github_actions_artifacts",
        repo: fallback.repo,
        artifact_prefixes: fallback.artifactPrefixes,
        artifact_limit: 0,
      },
      stats: {
        tracked_artifacts: 0,
        newly_processed_artifacts: 0,
        applied_summaries: 0,
        skipped_artifacts: 0,
        errors: 0,
      },
      artifacts: [],
    };
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function defaultListArtifacts({ repo, limit }) {
  const pageSize = 100;
  const artifacts = [];
  let page = 1;

  while (artifacts.length < limit) {
    const remaining = limit - artifacts.length;
    const currentPageSize = Math.min(pageSize, remaining);
    const payload = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/${repo}/actions/artifacts?per_page=${currentPageSize}&page=${page}`],
        { encoding: "utf8" },
      ),
    );
    const pageArtifacts = normalizeCollection(payload?.artifacts);
    if (pageArtifacts.length === 0) {
      break;
    }
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < currentPageSize) {
      break;
    }
    page += 1;
  }

  return artifacts.slice(0, limit);
}

export async function defaultDownloadArtifact({ repo, artifact, outputDir }) {
  const zipBuffer = execFileSync(
    "gh",
    ["api", `repos/${repo}/actions/artifacts/${artifact.id}/zip`],
    {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 50,
    },
  );
  const zipPath = path.join(outputDir, `${artifact.id}.zip`);
  await writeFile(zipPath, zipBuffer);
  execFileSync("unzip", ["-q", zipPath, "-d", outputDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  await rm(zipPath, { force: true });
}

export async function defaultFindSummaryFiles(rootDir) {
  return findFilesByBasename(rootDir, "core-summary.json");
}

async function findFilesByBasename(rootDir, basename) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findFilesByBasename(fullPath, basename));
      continue;
    }
    if (entry.isFile() && entry.name === basename) {
      matches.push(fullPath);
    }
  }
  return matches;
}

function buildAppliedSummaryRecord({ repoRoot, artifact, packet, result }) {
  return {
    artifact_id: Number(artifact.id),
    artifact_name: String(artifact.name ?? ""),
    workflow_run_id: numberOrNull(artifact.workflow_run?.id),
    artifact_created_at: firstString(artifact.created_at),
    lane: firstString(packet?.lane),
    status: firstString(packet?.status),
    receipt_id: firstString(packet?.receipt_id) || null,
    summary: firstString(packet?.summary),
    packet_created_at: firstString(packet?.created_at),
    subject_locator: firstString(packet?.subject?.locator) || null,
    target_repo: firstString(packet?.subject?.target_repo) || null,
    reflection_path: path.relative(repoRoot, result.reflection_path).replaceAll(path.sep, "/"),
    history_path: path.relative(repoRoot, result.history_path).replaceAll(path.sep, "/"),
    target_dossier_path: path.relative(repoRoot, result.target_dossier_path).replaceAll(path.sep, "/"),
  };
}

function buildProcessedArtifactRecord(artifact, summaries) {
  return {
    artifact_id: Number(artifact.id),
    name: String(artifact.name ?? ""),
    created_at: firstString(artifact.created_at),
    updated_at: firstString(artifact.updated_at),
    workflow_run_id: numberOrNull(artifact.workflow_run?.id),
    head_branch: firstString(artifact.workflow_run?.head_branch) || null,
    head_sha: firstString(artifact.workflow_run?.head_sha) || null,
    summaries: summaries.map((entry) => ({
      lane: entry.lane,
      status: entry.status,
      receipt_id: entry.receipt_id,
      summary: entry.summary,
      packet_created_at: entry.packet_created_at,
      subject_locator: entry.subject_locator,
      target_repo: entry.target_repo,
    })),
  };
}

function matchesArtifactPrefix(name, prefixes) {
  const normalized = String(name ?? "");
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function compareArtifactsByCreation(left, right) {
  const createdComparison = Date.parse(String(left?.created_at ?? "")) - Date.parse(String(right?.created_at ?? ""));
  if (createdComparison !== 0 && Number.isFinite(createdComparison)) {
    return createdComparison;
  }
  return Number(left?.id ?? 0) - Number(right?.id ?? 0);
}

function compareStateArtifactsByCreation(left, right) {
  const createdComparison = Date.parse(String(left?.created_at ?? "")) - Date.parse(String(right?.created_at ?? ""));
  if (createdComparison !== 0 && Number.isFinite(createdComparison)) {
    return createdComparison;
  }
  return Number(left?.artifact_id ?? 0) - Number(right?.artifact_id ?? 0);
}

function normalizeCollection(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of normalizeCollection(values)) {
    const normalized = firstString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    artifactPrefixes: [...defaultArtifactPrefixes],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--report-output") {
      options.reportOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--download-root") {
      options.downloadRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-prefix") {
      options.artifactPrefixes.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--limit") {
      options.limit = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
