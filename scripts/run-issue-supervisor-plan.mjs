import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPrereleaseEligibleTargetRepo } from "./automaton-v1-contracts.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const decision = JSON.parse(await readFile(path.resolve(options.decision), "utf8"));
  const planRequest = asRecord(decision?.workspace_change_plan_request)
    ?? asRecord(decision?.supervisor_decision?.workspace_change_plan_request);
  const changeSet = asRecord(decision?.change_set);

  if (!planRequest || !changeSet) {
    await writeJson(options.output, {
      status: "noop",
      reason: "planning was not requested",
    });
    return;
  }

  const outputPath = path.resolve(options.output);
  const bridgeOutput = `${outputPath}.bridge.json`;
  const artifactRoot = path.dirname(outputPath);
  const repo = process.env.GITHUB_REPOSITORY || "nilstate/automaton";
  const targetRepo = options.targetRepo ?? repo;
  if (!isPrereleaseEligibleTargetRepo(targetRepo)) {
    throw new Error(`target repo '${targetRepo}' is outside prerelease v1 scope.`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.resolve(options.receiptDir), { recursive: true });
  await mkdir(path.resolve(options.traceDir), { recursive: true });

  const runxRoot = path.resolve(options.runxRoot);
  const coreArgs = [
    path.join(repoRoot, "scripts", "automaton-core.mjs"),
    "--lane",
    "issue-supervisor-plan",
    "--runx-root",
    runxRoot,
    "--artifact-root",
    artifactRoot,
    "--subject-kind",
    "github_issue",
    "--subject-locator",
    `${targetRepo}#issue/${options.issueNumber ?? firstString(changeSet?.source?.id) ?? "unknown"}`,
    "--repo",
    repo,
    "--target-repo",
    targetRepo,
    "--issue-number",
    options.issueNumber ?? firstString(changeSet?.source?.id) ?? "unknown",
    "--receipt-dir",
    path.resolve(options.receiptDir),
    "--trace-dir",
    path.resolve(options.traceDir),
    "--output",
    bridgeOutput,
    "--",
    "skill",
    path.join(runxRoot, "skills", "objective-decompose"),
    "--objective",
    requireString(firstString(planRequest.objective), "workspace_change_plan_request.objective"),
    "--project_context",
    requireString(firstString(planRequest.project_context), "workspace_change_plan_request.project_context"),
    "--change_set",
    JSON.stringify(changeSet),
  ];

  execFileSync(process.execPath, coreArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  const bridgeResult = JSON.parse(await readFile(bridgeOutput, "utf8"));
  const payload = parseExecutionPayload(bridgeResult);
  const workspaceChangePlan = asRecord(payload?.workspace_change_plan);
  if (!workspaceChangePlan) {
    throw new Error("objective-decompose did not return workspace_change_plan.");
  }

  const objectiveSummary = requireString(firstString(payload?.objective_summary), "objective_summary");
  const output = {
    status: "success",
    receipt_id: firstString(bridgeResult?.receipt?.id) ?? "",
    change_set: asRecord(payload?.change_set) ?? changeSet,
    objective_summary: objectiveSummary,
    workspace_change_plan: workspaceChangePlan,
  };

  await writeJson(outputPath, output);
  if (options.commentOutput) {
    await writeFile(path.resolve(options.commentOutput), `${buildPlanComment(output)}\n`);
  }
}

function buildPlanComment(result) {
  const plan = asRecord(result.workspace_change_plan) ?? {};
  const phases = Array.isArray(plan.phases) ? plan.phases.map(asRecord).filter(Boolean) : [];
  const integrationChecks = Array.isArray(plan.integration_checks)
    ? plan.integration_checks.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const lines = [
    "### runx planning result",
    "",
    `- Change set: \`${firstString(plan.change_set_id) ?? "unknown"}\``,
    `- Objective: ${firstString(result.objective_summary) ?? "unknown"}`,
    `- Phases: \`${phases.length}\``,
  ];

  if (phases.length > 0) {
    lines.push("");
    lines.push("Planned phases:");
    for (const phase of phases) {
      const repoRequests = Array.isArray(phase.repo_change_requests)
        ? phase.repo_change_requests.map(asRecord).filter(Boolean)
        : [];
      lines.push(`- ${firstString(phase.name) ?? firstString(phase.id) ?? "unnamed phase"} (${repoRequests.length} repo request${repoRequests.length === 1 ? "" : "s"})`);
    }
  }

  if (integrationChecks.length > 0) {
    lines.push("");
    lines.push("Integration checks:");
    for (const check of integrationChecks) {
      lines.push(`- ${check}`);
    }
  }

  return lines.join("\n").trim();
}

function parseExecutionPayload(result) {
  const stdout = firstString(result?.execution?.stdout);
  if (!stdout) {
    throw new Error("runx result did not include execution stdout.");
  }
  return JSON.parse(stdout);
}

async function writeJson(outputPath, value) {
  await writeFile(path.resolve(outputPath), `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--decision") {
      options.decision = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--runx-root") {
      options.runxRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--receipt-dir") {
      options.receiptDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--trace-dir") {
      options.traceDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--target-repo") {
      options.targetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-number") {
      options.issueNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--comment-output") {
      options.commentOutput = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.decision || !options.runxRoot || !options.receiptDir || !options.traceDir || !options.output) {
    throw new Error("--decision, --runx-root, --receipt-dir, --trace-dir, and --output are required.");
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
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(value, label) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
