import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { ensureGeneratedPrPolicyBlock, parseGeneratedPrPolicy } from "./generated-pr-policy.mjs";

export function evaluateGeneratedPr({ publish, body, validation }) {
  const effectiveBody = publish?.policy?.lane
    ? ensureGeneratedPrPolicyBlock(body, {
        lane: publish.policy.lane,
        changeSurfacePolicy: publish?.change_surface_policy ?? null,
      })
    : body;
  const policy = parseGeneratedPrPolicy(effectiveBody);
  const validationCommands = Array.isArray(validation?.commands) ? validation.commands : [];
  const validationChecksTotal = validationCommands.length || Number(validation?.checks_total ?? 0);
  const validationChecksPassed = validationCommands.filter((entry) => {
    if (typeof entry === "string") {
      return true;
    }
    return entry && typeof entry === "object" && entry.status === "pass";
  }).length || Number(validation?.checks_passed ?? 0);
  const fileCount = Number(publish?.change_summary?.file_count ?? 0);
  const checks = {
    published: publish?.status === "published",
    policy_present: Boolean(policy),
    draft_only_policy: policy?.draft_only === true,
    change_surface_policy_recorded: Boolean(publish?.change_surface_policy),
    change_surface_policy_allowed: ["allowed", "report_only"].includes(publish?.change_surface_policy?.status),
    verification_recorded: (
      validationCommands.length > 0
      || typeof validation?.verification_profile === "string"
      || validationChecksTotal > 0
      || /receipts uploaded/i.test(effectiveBody)
    ),
    bounded_change: fileCount > 0 || publish?.status === "published",
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    schema: "runx.generated_pr_eval.v1",
    status: checks.published
      && checks.policy_present
      && checks.draft_only_policy
      && checks.change_surface_policy_recorded
      && checks.change_surface_policy_allowed
      && checks.verification_recorded
      ? "pass"
      : "needs_review",
    lane: policy?.lane ?? publish?.policy?.lane ?? "unknown",
    checks,
    score: Math.round((passed / Object.keys(checks).length) * 1000) / 1000,
    metrics: {
      file_count: fileCount,
      additions: Number(publish?.change_summary?.additions ?? 0),
      deletions: Number(publish?.change_summary?.deletions ?? 0),
      validation_commands: validationCommands.length,
      validation_checks_total: validationChecksTotal,
      validation_checks_passed: validationChecksPassed,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const publish = JSON.parse(await readFile(options.publish, "utf8"));
  const body = await readFile(options.bodyFile, "utf8");
  const validation = options.validation
    ? JSON.parse(await readFile(options.validation, "utf8"))
    : {};
  const evaluation = evaluateGeneratedPr({ publish, body, validation });
  const serialized = `${JSON.stringify(evaluation, null, 2)}\n`;
  if (options.output) {
    await writeFile(options.output, serialized);
  }
  process.stdout.write(serialized);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--publish") {
      options.publish = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--body-file") {
      options.bodyFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--validation") {
      options.validation = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.publish || !options.bodyFile) {
    throw new Error("--publish and --body-file are required.");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
