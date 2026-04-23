import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await materializeSkillProposal(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function materializeSkillProposal(options) {
  const report = JSON.parse(await readFile(options.input, "utf8"));
  const payload = extractSkillProposalPayload(report);
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
  const proposalTitle = firstNonEmptyString(payload.skill_spec?.name, payload.skill_spec?.skill_name, title);
  const proposalDescription = cleanReaderFacingText(
    payload.skill_spec?.description
    ?? payload.skill_spec?.summary
    ?? payload.skill_spec?.purpose
    ?? "First-party runx skill proposal.",
  );
  const acceptanceChecks = formatAcceptanceChecks(payload.acceptance_checks);
  const effectiveObjective = cleanReaderFacingText(
    firstNonEmptyString(payload.skill_spec?.objective, payload.skill_spec?.summary, payload.skill_spec?.purpose, title)
    ?? "Define the bounded job this skill should perform.",
  );

  const sourceSections = issuePacket?.sections ?? {};
  const whyThisMatters = cleanReaderFacingText(firstNonEmptyString(
    payload.skill_spec?.maintainer_pain,
    payload.why_this_matters,
    sourceSections.why_it_matters,
  ));
  const maintainerAmendments = Array.isArray(issuePacket?.amendments) ? issuePacket.amendments : [];
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const recommendedFlow = Array.isArray(payload.recommended_flow) ? payload.recommended_flow : [];
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const risks = Array.isArray(payload.risks) ? payload.risks : [];
  const harnessFixture = Array.isArray(payload.harness_fixture) ? payload.harness_fixture : [];
  const openQuestions = Array.isArray(payload.execution_plan?.open_questions_left_out_of_scope)
    ? payload.execution_plan.open_questions_left_out_of_scope.filter(Boolean)
    : [];
  const workIssueRepo = firstNonEmptyString(issuePacket?.source_issue?.repo);
  const workIssueNumber = normalizeWorkIssueNumber(issuePacket?.source_issue?.number);
  const workIssueRef = workIssueRepo && workIssueNumber
    ? `${workIssueRepo}#${workIssueNumber}`
    : null;
  const ledgerRevision = firstNonEmptyString(issuePacket?.source_issue?.ledger_revision);
  const lines = [
    "---",
    `title: ${yamlString(proposalTitle)}`,
    `description: ${yamlString(proposalDescription)}`,
    "---",
    "",
    `# ${proposalTitle}`,
    "",
    "## Thesis",
    "",
    proposalDescription,
    "",
    "## Job To Be Done",
    "",
    effectiveObjective,
    "",
  ];

  if (whyThisMatters) {
    lines.push("## Why This Matters", "", whyThisMatters, "");
  }

  lines.push(
    ...formatFlexibleSection("Pain Points", payload.pain_points),
    ...formatCatalogFitSection(payload.catalog_fit),
    "## Contract",
    "",
    `- name: \`${firstNonEmptyString(payload.skill_spec?.name, payload.skill_spec?.skill_name) ?? "unknown"}\``,
    payload.skill_spec?.kind ? `- kind: \`${payload.skill_spec.kind}\`` : null,
    payload.skill_spec?.status ? `- status: \`${payload.skill_spec.status}\`` : null,
    `- description: ${cleanReaderFacingText(payload.skill_spec?.description ?? payload.skill_spec?.summary ?? payload.skill_spec?.purpose ?? "n/a")}`,
    Array.isArray(payload.skill_spec?.composes_with) && payload.skill_spec.composes_with.length > 0
      ? `- composes_with: ${payload.skill_spec.composes_with.map((value) => `\`${value}\``).join(", ")}`
      : null,
    "",
    ...formatNamedObjectSection("Governance", payload.skill_spec?.governance),
    ...formatBulletSection("Invariants", payload.skill_spec?.invariants),
    ...formatFieldSchemaSection("Inputs", payload.skill_spec?.inputs),
    ...formatFieldSchemaSection("Outputs", payload.skill_spec?.outputs),
    ...formatBoundarySection({ constraints: sourceSections.constraints, risks }),
    ...formatFindingsSection(findings),
    ...formatRecommendedFlowSection(recommendedFlow),
    ...formatExecutionShapeSection(payload.execution_plan),
    ...formatHarnessSection(harnessFixture),
    "## Acceptance Checks",
    "",
    ...acceptanceChecks,
    "",
    ...formatOpenDecisionSection({ maintainerDecisions: payload.maintainer_decisions, openQuestions }),
    "## Provenance",
    "",
    workIssueRef ? `- Work issue: \`${workIssueRef}\`` : null,
    issueUrl ? `- Source thread: ${issueUrl}` : null,
    ledgerRevision ? `- Ledger revision: \`${ledgerRevision}\`` : null,
    maintainerAmendments.length > 0
      ? `- Trusted maintainer amendments considered: ${maintainerAmendments.length}. Details remain on the source thread.`
      : null,
    sourceSections.evidence ? `- Evidence note: ${collapseWhitespace(sourceSections.evidence)}` : null,
    ...formatSourcesList(sources),
    `- Machine-readable packet: [${path.basename(jsonPath)}](./${path.basename(jsonPath)}).`,
    "",
  );

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

export function extractSkillProposalPayload(report) {
  if (isSkillProposalPayload(report)) {
    return report;
  }

  const stdout = firstNonEmptyString(report?.execution?.stdout);
  const parsed = tryParseJson(stdout);
  if (isSkillProposalPayload(parsed)) {
    return parsed;
  }

  throw new Error("Skill proposal payload not found in run result.");
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
    return ["- none"];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return `- ${cleanReaderFacingText(item)}`;
    }
    if (item && typeof item === "object") {
      const id = typeof item.id === "string" ? `\`${item.id}\`` : null;
      const summary = cleanReaderFacingText(firstNonEmptyString(item.assertion, item.summary, item.question));
      if (id && summary) {
        return `- ${id}: ${summary}`;
      }
      if (summary) {
        return `- ${summary}`;
      }
      return `- ${cleanReaderFacingText(JSON.stringify(item))}`;
    }
    return `- ${cleanReaderFacingText(item)}`;
  });
}

function formatFieldSchemaSection(title, value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  const lines = [title ? `## ${title}` : "", ""];
  for (const field of value) {
    if (!field || typeof field !== "object") {
      lines.push(`- ${String(field)}`);
      continue;
    }
    const name = firstNonEmptyString(field.name) ?? "unknown";
    const type = firstNonEmptyString(field.type);
    const required = typeof field.required === "boolean" ? field.required : null;
    const description = cleanReaderFacingText(firstNonEmptyString(field.description));
    const parts = [`\`${name}\``];
    if (type) {
      parts.push(`type=\`${type}\``);
    }
    if (required !== null) {
      parts.push(required ? "required" : "optional");
    }
    if (description) {
      parts.push(description);
    }
    lines.push(`- ${parts.join(" · ")}`);
  }
  lines.push("");
  return lines;
}

function formatNamedObjectSection(title, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const lines = [`## ${title}`, ""];
  for (const [key, raw] of Object.entries(value)) {
    lines.push(...formatObjectFieldLines(key, raw));
  }
  lines.push("");
  return lines;
}

function formatBulletSection(title, value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return [
    `## ${title}`,
    "",
    ...value.map((entry) => `- ${formatInlineValue(entry)}`),
    "",
  ];
}

function formatFlexibleSection(title, value) {
  if (value == null) {
    return [];
  }
  if (typeof value === "string") {
    return [`## ${title}`, "", cleanReaderFacingText(value), ""];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    const lines = [`## ${title}`, ""];
    for (const item of value) {
      if (typeof item === "string") {
        lines.push(`- ${cleanReaderFacingText(item)}`);
        continue;
      }
      if (item && typeof item === "object") {
        const summary = cleanReaderFacingText(firstNonEmptyString(
          item.summary,
          item.problem,
          item.question,
          item.title,
          item.name,
        ));
        if (summary) {
          lines.push(`- ${summary}`);
        } else {
          lines.push(`- ${cleanReaderFacingText(JSON.stringify(item))}`);
        }
        const details = [
          cleanReaderFacingText(firstNonEmptyString(item.why)),
          cleanReaderFacingText(firstNonEmptyString(item.relevance)),
          cleanReaderFacingText(firstNonEmptyString(item.rationale)),
        ].filter(Boolean);
        if (details.length > 0) {
          lines.push(`  ${details.join(" · ")}`);
        }
        const options = Array.isArray(item.options) ? item.options.filter(Boolean) : [];
        if (options.length > 0) {
          lines.push(`  options: ${options.map((option) => formatInlineValue(option)).join(" | ")}`);
        }
        continue;
      }
      lines.push(`- ${cleanReaderFacingText(item)}`);
    }
    lines.push("");
    return lines;
  }
  if (typeof value === "object") {
    return formatNamedObjectSection(title, value);
  }
  return [`## ${title}`, "", cleanReaderFacingText(value), ""];
}

function formatCatalogFitSection(value) {
  const lines = formatFlexibleSection("Catalog Fit", value);
  if (lines.length > 0) {
    return lines;
  }
  return [
    "## Catalog Fit",
    "",
    "- This proposal still needs a clear boundary against the current runx catalog before it should publish.",
    "",
  ];
}

function formatBoundarySection({ constraints, risks }) {
  const lines = ["## Boundaries", ""];
  let wrote = false;
  if (constraints) {
    lines.push(...formatBlockLines(constraints), "");
    wrote = true;
  }
  const riskLines = formatRisksSection(risks);
  if (riskLines.length > 0) {
    lines.push(...riskLines);
    wrote = true;
  }
  return wrote ? lines : [];
}

function formatFindingsSection(findings) {
  if (findings.length === 0) {
    return [];
  }

  const lines = ["## Findings", ""];
  for (const finding of findings) {
    if (!finding || typeof finding !== "object") {
      lines.push(`- ${cleanReaderFacingText(finding)}`);
      continue;
    }
    const claim = cleanReaderFacingText(firstNonEmptyString(finding.claim) ?? JSON.stringify(finding));
    lines.push(`- ${claim}`);
    const source = cleanReaderFacingText(firstNonEmptyString(finding.source));
    if (source) {
      lines.push(`  source: ${source}`);
    }
    const relevance = cleanReaderFacingText(firstNonEmptyString(finding.relevance));
    if (relevance) {
      lines.push(`  relevance: ${relevance}`);
    }
    const confidence = firstNonEmptyString(finding.confidence);
    if (confidence) {
      lines.push(`  confidence: ${confidence}`);
    }
  }
  lines.push("");
  return lines;
}

function formatRecommendedFlowSection(flow) {
  if (flow.length === 0) {
    return [];
  }

  const lines = ["## Implementation Shape", ""];
  for (const item of flow) {
    if (!item || typeof item !== "object") {
      lines.push(`- ${cleanReaderFacingText(item)}`);
      continue;
    }
    const step = cleanReaderFacingText(firstNonEmptyString(item.step) ?? JSON.stringify(item));
    lines.push(`- ${step}`);
    const details = cleanReaderFacingText(firstNonEmptyString(item.details, item.basis));
    if (details) {
      lines.push(`  ${details}`);
    }
  }
  lines.push("");
  return lines;
}

function formatExecutionShapeSection(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return [];
  }

  const lines = [];
  const runner = firstNonEmptyString(plan.runner, plan.type);
  if (runner) {
    lines.push(`- runner: \`${runner}\``);
  }
  const stages = Array.isArray(plan.stages) ? plan.stages : Array.isArray(plan.steps) ? plan.steps : [];
  for (const stage of stages) {
    if (typeof stage === "string") {
      lines.push(`- ${cleanReaderFacingText(stage)}`);
      continue;
    }
    if (stage && typeof stage === "object") {
      const label = cleanReaderFacingText(firstNonEmptyString(stage.name, stage.id, stage.step, stage.summary));
      const details = cleanReaderFacingText(firstNonEmptyString(stage.description, stage.details, stage.reason));
      if (label && details) {
        lines.push(`- ${label}: ${details}`);
      } else if (label) {
        lines.push(`- ${label}`);
      }
    }
  }

  if (lines.length === 0) {
    return [];
  }

  return ["## Execution Notes", "", ...lines, ""];
}

function formatHarnessSection(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return [];
  }

  const lines = ["## Harness", ""];
  for (const fixture of fixtures) {
    if (typeof fixture === "string") {
      lines.push(`- ${cleanReaderFacingText(fixture)}`);
      continue;
    }
    if (!fixture || typeof fixture !== "object") {
      lines.push(`- ${cleanReaderFacingText(fixture)}`);
      continue;
    }
    const name = cleanReaderFacingText(firstNonEmptyString(fixture.name, fixture.id, fixture.case, fixture.title)) ?? "fixture";
    const summary = cleanReaderFacingText(firstNonEmptyString(fixture.summary, fixture.description, fixture.expected, fixture.expect));
    lines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
  }
  lines.push("");
  return lines;
}

function formatOpenDecisionSection({ maintainerDecisions, openQuestions }) {
  const decisionLines = formatFlexibleSection("Open Decisions", maintainerDecisions);
  if (decisionLines.length > 0) {
    return decisionLines;
  }
  if (openQuestions.length === 0) {
    return [];
  }
  return [
    "## Open Decisions",
    "",
    ...openQuestions.map((question) => `- ${formatInlineValue(question)}`),
    "",
  ];
}

function formatSourcesList(sources) {
  if (sources.length === 0) {
    return [];
  }

  const lines = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      lines.push(`- ${cleanReaderFacingText(source)}`);
      continue;
    }
    const title = cleanReaderFacingText(firstNonEmptyString(source.title, source.reference) ?? JSON.stringify(source));
    const locator = firstNonEmptyString(source.locator);
    const details = cleanReaderFacingText(firstNonEmptyString(source.notes, source.details));
    const parts = [title];
    if (locator) {
      parts.push(locator);
    }
    lines.push(`- ${parts.join(" — ")}`);
    if (details) {
      lines.push(`  ${details}`);
    }
  }
  return lines;
}

function formatRisksSection(risks) {
  if (risks.length === 0) {
    return [];
  }

  const lines = ["## Risks", ""];
  for (const risk of risks) {
    if (!risk || typeof risk !== "object") {
      lines.push(`- ${cleanReaderFacingText(risk)}`);
      continue;
    }
    const summary = cleanReaderFacingText(firstNonEmptyString(risk.risk) ?? JSON.stringify(risk));
    lines.push(`- ${summary}`);
    const meta = [
      firstNonEmptyString(risk.likelihood) ? `likelihood=${risk.likelihood}` : null,
      firstNonEmptyString(risk.impact) ? `impact=${risk.impact}` : null,
    ].filter(Boolean);
    if (meta.length > 0) {
      lines.push(`  ${meta.join(" · ")}`);
    }
    const mitigation = cleanReaderFacingText(firstNonEmptyString(risk.mitigation));
    if (mitigation) {
      lines.push(`  mitigation: ${mitigation}`);
    }
  }
  lines.push("");
  return lines;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function collapseWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReaderFacingText(value) {
  if (value == null) {
    return null;
  }
  return String(value)
    .replace(/\b(?:supplied|provided)\s+catalog\s+evidence\b/gi, "current catalog")
    .replace(/\b(?:supplied|provided)\s+catalog\s+entries\b/gi, "current catalog entries")
    .replace(/\b(?:supplied|provided)\s+catalog\b/gi, "current catalog")
    .replace(/\bsupplied\b/gi, "provided")
    .replace(/\bprior\s+(?:machine|agent|model|llm|ai)\s+output\b/gi, "prior run artifacts")
    .replace(/\b(?:machine|agent|model|llm|ai)\s+output\b/gi, "run output")
    .replace(/\bthe\s+(?:machine|agent|model|llm|ai)\s+should\b/gi, "the skill should")
    .trim();
}

function formatBlockLines(value) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return [collapseWhitespace(value)];
  }
  return lines;
}

function normalizeWorkIssueNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function isSkillProposalPayload(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (
      value.skill_spec
      || value.execution_plan
      || value.harness_fixture
      || value.acceptance_checks
    ),
  );
}

function formatInlineValue(value) {
  if (typeof value === "string") {
    return cleanReaderFacingText(value);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatInlineValue(entry)).join(", ");
  }
  if (value && typeof value === "object") {
    return formatObjectSummary(value);
  }
  return "n/a";
}

function formatObjectFieldLines(key, raw) {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return [`- ${key}: none`];
    }
    if (raw.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) {
      return [
        `- ${key}:`,
        ...raw.map((entry) => `  - ${formatObjectSummary(entry)}`),
      ];
    }
    return [`- ${key}: ${formatInlineValue(raw)}`];
  }
  return [`- ${key}: ${formatInlineValue(raw)}`];
}

function formatObjectSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cleanReaderFacingText(value);
  }
  const label = cleanReaderFacingText(firstNonEmptyString(
    value.name,
    value.capability,
    value.option,
    value.id,
    value.kind,
    value.title,
  ));
  const detail = cleanReaderFacingText(firstNonEmptyString(
    value.why,
    value.boundary,
    value.effect,
    value.assertion,
    value.summary,
    value.description,
    value.rationale,
    value.mitigation,
  ));
  if (label && detail) {
    return `${label}: ${detail}`;
  }
  if (label) {
    return label;
  }
  if (detail) {
    return detail;
  }
  return Object.entries(value)
    .map(([entryKey, entryValue]) => `${entryKey}=${formatInlineValue(entryValue)}`)
    .join(" · ");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
