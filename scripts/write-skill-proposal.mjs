import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await materializeSkillProposal(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function materializeSkillProposal(options) {
  const report = JSON.parse(await readFile(options.input, "utf8"));
  const payload = JSON.parse(report.execution.stdout);
  const issuePacket = options.issuePacket
    ? JSON.parse(await readFile(path.resolve(options.issuePacket), "utf8"))
    : null;
  const skillName = payload.skill_spec?.name ?? slugify(options.title);
  const slug = slugify(skillName);
  const outputDir = path.resolve(options.outputDir ?? "docs/skill-proposals");
  const markdownPath = path.join(outputDir, `${slug}.md`);
  const jsonPath = path.join(outputDir, `${slug}.json`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(
    markdownPath,
    `${buildSkillProposalMarkdown({
      payload,
      title: options.title,
      issueUrl: issuePacket?.source_issue?.url ?? options.issueUrl,
      issuePacket,
      jsonPath,
    })}\n`,
  );

  return {
    status: "written",
    markdown_path: markdownPath,
    json_path: jsonPath,
  };
}

export function buildSkillProposalMarkdown({ payload, title, issueUrl, issuePacket, jsonPath }) {
  const proposalTitle = payload.skill_spec?.name ?? title;
  const proposalDescription =
    payload.skill_spec?.description
    ?? payload.skill_spec?.summary
    ?? "Generated skill proposal.";
  const acceptanceChecks = formatAcceptanceChecks(payload.acceptance_checks);

  const sourceSections = issuePacket?.sections ?? {};
  const lines = [
    "---",
    `title: ${yamlString(proposalTitle)}`,
    `description: ${yamlString(proposalDescription)}`,
    "---",
    "",
    `# ${proposalTitle}`,
    "",
    `Source issue: ${issueUrl ?? "n/a"}`,
    "",
    "## Objective",
    "",
    title,
    "",
  ];

  if (sourceSections.why_it_matters) {
    lines.push("## Why It Matters", "", sourceSections.why_it_matters, "");
  }
  if (sourceSections.constraints) {
    lines.push("## Constraints", "", sourceSections.constraints, "");
  }
  if (sourceSections.evidence) {
    lines.push("## Evidence", "", sourceSections.evidence, "");
  }
  if (sourceSections.additional_notes) {
    lines.push("## Additional Notes", "", sourceSections.additional_notes, "");
  }

  lines.push(
    "## Skill Contract",
    "",
    `- name: \`${payload.skill_spec?.name ?? "unknown"}\``,
    `- description: ${payload.skill_spec?.description ?? payload.skill_spec?.summary ?? "n/a"}`,
    "",
    "## Execution Plan",
    "",
    "```json",
    JSON.stringify(payload.execution_plan ?? {}, null, 2),
    "```",
    "",
    "## Harness Fixtures",
    "",
    "```json",
    JSON.stringify(payload.harness_fixture ?? [], null, 2),
    "```",
    "",
    "## Acceptance Checks",
    "",
    ...acceptanceChecks,
    "",
    "## Raw Packet",
    "",
    `See [${path.basename(jsonPath)}](./${path.basename(jsonPath)}).`,
    "",
  );

  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--title") {
      options.title = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-url") {
      options.issueUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-packet") {
      options.issuePacket = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output-dir") {
      options.outputDir = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.input || !options.title || !options.issueUrl) {
    throw new Error("--input, --title, and --issue-url are required.");
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function formatAcceptanceChecks(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return ["- none supplied"];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return `- ${item}`;
    }
    if (item && typeof item === "object") {
      const id = typeof item.id === "string" ? `\`${item.id}\`` : null;
      const summary = firstNonEmptyString(item.assertion, item.summary, item.question);
      if (id && summary) {
        return `- ${id}: ${summary}`;
      }
      if (summary) {
        return `- ${summary}`;
      }
      return `- ${JSON.stringify(item)}`;
    }
    return `- ${String(item)}`;
  });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
