import { readFile, writeFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const report = JSON.parse(await readFile(options.input, "utf8"));
const payload = parsePayload(report);
const body = firstNonEmptyString(
  payload.response_draft?.body,
  payload.response_draft?.public_comment,
  payload.response_draft?.comment_body,
  payload.publish_packet?.body,
  payload.comment?.body,
);

if (!body) {
  if (isNoPublicComment(payload)) {
    if (options.output) {
      await writeFile(decisionOutputPath(options.output), `${JSON.stringify({
        status: "no_public_comment",
        mode: payload.response_draft?.mode ?? null,
        reason: firstNonEmptyString(
          payload.response_strategy?.next_best_action,
          payload.response_strategy?.next_best_step,
          payload.response_draft?.internal_handoff,
          payload.response_strategy?.recommended_posture,
          payload.response_strategy?.recommended_action,
        ) ?? "The triage run did not recommend a public comment.",
      }, null, 2)}\n`);
    }
    process.stdout.write("No public triage comment recommended.\n");
    process.exit(0);
  }
  throw new Error("Could not find a public comment body in the run output.");
}

if (options.output) {
  await writeFile(options.output, `${body.trim()}\n`);
} else {
  process.stdout.write(`${body.trim()}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.input) {
    throw new Error("--input is required.");
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

function parsePayload(report) {
  if (isRecord(report) && isRecord(report.response_draft)) {
    return report;
  }
  const stdout = report?.execution?.stdout;
  if (typeof stdout !== "string" || !stdout.trim()) {
    throw new Error("Could not find execution.stdout in the run output.");
  }
  return JSON.parse(stdout);
}

function isNoPublicComment(payload) {
  if (payload?.response_strategy?.should_post_public_comment === false) {
    return true;
  }
  if (payload?.response_draft?.should_post === false) {
    return true;
  }
  const mode = String(payload?.response_draft?.mode ?? "").toLowerCase();
  if (["internal_no_op", "no_public_comment", "no_op", "internal"].includes(mode)) {
    return true;
  }
  const recommendedAction = String(payload?.response_strategy?.recommended_action ?? "").toLowerCase();
  if (["no_public_comment", "defer_public_comment"].includes(recommendedAction)) {
    return true;
  }
  return payload?.response_draft?.public_comment === null
    && typeof payload?.response_draft?.internal_handoff === "string"
    && payload.response_draft.internal_handoff.trim().length > 0;
}

function decisionOutputPath(outputPath) {
  return outputPath.endsWith(".md")
    ? outputPath.replace(/\.md$/, ".decision.json")
    : `${outputPath}.decision.json`;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
