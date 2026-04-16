import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const contextBundle = JSON.parse(await readFile(path.resolve(options.context), "utf8"));
  const runResult = JSON.parse(await readFile(path.resolve(options.runResult), "utf8"));
  const drafts = buildPromotionDrafts({
    lane: options.lane,
    contextBundle,
    runResult,
    now: options.now ? new Date(options.now) : new Date(),
  });
  const written = await writePromotionDrafts({
    outputDir: path.resolve(options.outputDir),
    drafts,
  });

  const summary = {
    lane: options.lane,
    status: drafts.packet.status,
    summary: drafts.packet.summary,
    outputs: written,
  };

  if (options.summaryOutput) {
    await writeFile(path.resolve(options.summaryOutput), `${JSON.stringify(summary, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

export function buildPromotionDrafts({ lane, contextBundle, runResult, now = new Date() }) {
  const signal = extractRunSignal(runResult);
  const date = toDateStamp(now);
  const subjectLabel = String(contextBundle?.subject?.locator ?? contextBundle?.subject?.target_repo ?? "subject");
  const subjectSlug = slugify(subjectLabel);
  const summarySlug = slugify(signal.summary).slice(0, 48) || lane;
  const baseName = `${date}-${lane}-${subjectSlug}-${summarySlug}`.replace(/-+/g, "-");
  const receiptId = firstString(runResult?.receipt?.id);

  const packet = {
    created_at: now.toISOString(),
    lane,
    status: runResult?.status ?? "unknown",
    receipt_id: receiptId || null,
    summary: signal.summary,
    feed_channel: feedChannelForLane(lane, runResult?.status ?? "unknown"),
    main_feed_eligible: isMainFeedEligible(lane, runResult?.status ?? "unknown"),
    subject: contextBundle?.subject ?? {},
    signal,
  };

  return {
    packet,
    reflection: {
      filename: `${baseName}.md`,
      content: buildReflectionDraft({ date, lane, contextBundle, packet }),
    },
    history: {
      filename: `${baseName}.md`,
      content: buildHistoryDraft({ date, lane, contextBundle, packet }),
    },
    packetJson: {
      filename: `${baseName}.json`,
      content: `${JSON.stringify(packet, null, 2)}\n`,
    },
  };
}

export async function writePromotionDrafts({ outputDir, drafts }) {
  await mkdir(outputDir, { recursive: true });
  const reflectionPath = path.join(outputDir, drafts.reflection.filename);
  const historyPath = path.join(outputDir, `history-${drafts.history.filename}`);
  const packetPath = path.join(outputDir, drafts.packetJson.filename);

  await writeFile(reflectionPath, drafts.reflection.content);
  await writeFile(historyPath, drafts.history.content);
  await writeFile(packetPath, drafts.packetJson.content);

  return {
    reflection_path: reflectionPath,
    history_path: historyPath,
    packet_path: packetPath,
  };
}

export function extractRunSignal(runResult) {
  const stdout = firstString(runResult?.execution?.stdout);
  const parsed = tryParseJson(stdout);
  const triage = asRecord(parsed?.triage_report);
  const skillSpec = asRecord(parsed?.skill_spec);
  const changeSet = asRecord(parsed?.change_set);
  const workspaceChangePlan = asRecord(parsed?.workspace_change_plan);

  const summary =
    firstString(triage?.summary)
    || firstString(parsed?.objective_summary)
    || firstString(skillSpec?.name)
    || firstString(changeSet?.summary)
    || firstString(workspaceChangePlan?.change_set_id)
    || `lane finished with ${runResult?.status ?? "unknown"}`;

  return {
    summary,
    recommended_lane: firstString(triage?.recommended_lane) || null,
    suggested_reply: firstString(triage?.suggested_reply) || null,
    objective_summary: firstString(parsed?.objective_summary) || null,
  };
}

function buildReflectionDraft({ date, lane, contextBundle, packet }) {
  const subject = contextBundle?.subject ?? {};
  const lines = [
    "---",
    `title: ${humanizeTitle(lane)} — ${packet.summary}`,
    `date: ${date}`,
    "visibility: public",
    `lane: ${lane}`,
    `status: ${packet.status}`,
    `feed_channel: ${packet.feed_channel}`,
    `main_feed_eligible: ${String(packet.main_feed_eligible)}`,
  ];

  if (packet.receipt_id) {
    lines.push(`receipt_id: ${packet.receipt_id}`);
  }
  if (subject.kind) {
    lines.push(`subject_kind: ${subject.kind}`);
  }
  if (subject.locator) {
    lines.push(`subject_locator: ${subject.locator}`);
  }
  if (subject.target_repo) {
    lines.push(`target_repo: ${subject.target_repo}`);
  }
  if (subject.issue_number) {
    lines.push(`issue_number: ${subject.issue_number}`);
  }
  if (subject.pr_number) {
    lines.push(`pr_number: ${subject.pr_number}`);
  }
  lines.push("---", "", `# ${humanizeTitle(lane)} — ${packet.summary}`, "");
  lines.push("## What Happened", "");
  lines.push(`- Lane: \`${lane}\``);
  lines.push(`- Subject: \`${contextBundle?.subject?.locator ?? "unknown"}\``);
  lines.push(`- Status: \`${packet.status}\``);
  if (packet.receipt_id) {
    lines.push(`- Receipt: \`${packet.receipt_id}\``);
  }

  lines.push("", "## Signals", "");
  lines.push(`- Summary: ${packet.summary}`);
  if (packet.signal.recommended_lane) {
    lines.push(`- Recommended next lane: \`${packet.signal.recommended_lane}\``);
  }
  if (packet.signal.suggested_reply) {
    lines.push(`- Suggested reply: ${packet.signal.suggested_reply}`);
  }

  lines.push("", "## Promotion Notes", "");
  lines.push("- This reflection draft is derived from the run result and bounded context bundle.");
  lines.push("- Promote into `state/` only after the underlying evidence is reviewed and worth retaining.");
  lines.push("- Promote into `history/` only if the event is part of the public evolutionary trail.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildHistoryDraft({ date, lane, contextBundle, packet }) {
  const subject = contextBundle?.subject ?? {};
  const title = `${humanizeTitle(lane)} — ${packet.summary}`;
  const lines = [
    "---",
    `title: ${title}`,
    `date: ${date}`,
    "visibility: public",
    `lane: ${lane}`,
    `status: ${packet.status}`,
    `feed_channel: ${packet.feed_channel}`,
    `main_feed_eligible: ${String(packet.main_feed_eligible)}`,
  ];
  if (subject.kind) {
    lines.push(`subject_kind: ${subject.kind}`);
  }
  if (subject.locator) {
    lines.push(`subject_locator: ${subject.locator}`);
  }
  if (subject.target_repo) {
    lines.push(`target_repo: ${subject.target_repo}`);
  }
  if (subject.issue_number) {
    lines.push(`issue_number: ${subject.issue_number}`);
  }
  if (subject.pr_number) {
    lines.push(`pr_number: ${subject.pr_number}`);
  }
  lines.push(
    "---",
    "",
    `# ${title}`,
    "",
    `A \`${lane}\` run against \`${contextBundle?.subject?.locator ?? "unknown"}\` finished with \`${packet.status}\`.`,
    "",
    `Summary: ${packet.summary}`,
  );
  if (packet.receipt_id) {
    lines.push("", `Receipt reference: \`${packet.receipt_id}\`.`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--context") {
      options.context = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--run-result") {
      options.runResult = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output-dir") {
      options.outputDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--summary-output") {
      options.summaryOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.lane || !options.context || !options.runResult || !options.outputDir) {
    throw new Error("--lane, --context, --run-result, and --output-dir are required.");
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

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function toDateStamp(value) {
  return value.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanizeTitle(value) {
  return String(value ?? "")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function feedChannelForLane(lane, status) {
  return isMainFeedEligible(lane, status) ? "main" : "ops";
}

function isMainFeedEligible(lane, status) {
  const normalizedLane = String(lane ?? "").trim();
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (!["success", "completed", "merged", "published"].includes(normalizedStatus)) {
    return false;
  }
  return [
    "pr-triage",
    "issue-supervisor",
    "skill-contribution",
    "skill-contribution-watch",
    "market-brief",
    "trust-report",
  ].includes(normalizedLane);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
