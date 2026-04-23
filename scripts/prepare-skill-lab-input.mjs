import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const issue = JSON.parse(await readFile(path.resolve(options.input), "utf8"));
  const catalogEntries = options.catalogFile
    ? await readCatalogEntries(path.resolve(options.catalogFile))
    : [];
  const prepared = prepareSkillLabInput(issue, { catalogEntries });

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(prepared, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}

export function prepareSkillLabInput(issue = {}, options = {}) {
  const sourceIssue = issue?.issue && typeof issue.issue === "object" ? issue.issue : issue;
  const catalogEntries = Array.isArray(options.catalogEntries) ? options.catalogEntries : [];
  const sourceRepo = normalizeString(issue?.repo) ?? null;
  const rawAmendments = Array.isArray(issue?.amendments)
    ? issue.amendments
    : Array.isArray(issue?.trusted_human_comments)
      ? issue.trusted_human_comments
      : [];
  const amendments = rawAmendments
    .filter((amendment) => amendment?.is_machine_status_comment !== true)
    .map((amendment) => ({
      author: normalizeString(amendment.author) ?? null,
      url: normalizeString(amendment.url) ?? null,
      body: normalizeString(amendment.body) ?? null,
      recorded_at: firstNonEmpty(amendment.updated_at, amendment.created_at),
      thread_teaching_record:
        amendment?.thread_teaching_record && typeof amendment.thread_teaching_record === "object"
          ? amendment.thread_teaching_record
          : null,
    }));
  const rawTitle = normalizeString(sourceIssue.title) ?? "Untitled skill proposal";
  const rawBody = normalizeString(sourceIssue.body) ?? "";
  const sectionExtraction = extractNamedSections(rawBody);
  const objective = firstNonEmpty(
    normalizeString(sectionExtraction.sections.objective),
    stripSkillPrefix(rawTitle),
    rawTitle,
  );

  const whyItMatters = normalizeString(sectionExtraction.sections.why_it_matters);
  const constraints = normalizeString(sectionExtraction.sections.constraints);
  const evidence = normalizeString(sectionExtraction.sections.evidence);
  const notes = normalizeString(sectionExtraction.notes);

  const projectContextParts = [
    "Source Issue",
    formatBulletList([
      `title: ${rawTitle}`,
      sourceIssue.url ? `url: ${sourceIssue.url}` : null,
    ]),
    "Proposal Quality Bar",
    formatBulletList([
      "The deliverable should read like a crisp first-party runx skill proposal, not a builder transcript.",
      "The public proposal must look like a maintainer did the work: compact thesis, concrete user pain, clear catalog boundary, and implementation-ready contract.",
      "Evidence, amendments, and approval comments inform the proposal; do not paste the issue thread, ledger, or machine packet into the reader-facing content.",
      "Name the concrete operator or maintainer pain the skill resolves.",
      "Explain fit against the current runx catalog and why this is not just duplication of an adjacent skill or chain.",
      "If the idea is better handled by Sourcey, draft-content, an existing skill, or a chain amendment, say that instead of forcing a new skill.",
      "Turn unresolved ambiguity into explicit maintainer decisions rather than placeholder targets or internal residue.",
      "Write from the maintainer's viewpoint. Do not describe evidence as 'supplied work-plan', 'supplied catalog', 'supplied decomposition', 'agent output', or 'model output'.",
      "When discussing catalog fit, name the adjacent capability and boundary directly: 'Compared with issue-triage...' not 'Based on the supplied catalog...'.",
    ]),
    catalogEntries.length > 0
      ? [
          "Current runx catalog",
          formatBulletList([
            `consider these adjacent catalog entries before proposing something new: ${catalogEntries.join(", ")}`,
          ]),
        ].join("\n")
      : null,
    whyItMatters ? `Why It Matters\n${whyItMatters}` : null,
    constraints ? `Constraints\n${constraints}` : null,
    evidence ? `Evidence\n${evidence}` : null,
    amendments.length > 0 ? `Maintainer Amendments\n${formatAmendments(amendments)}` : null,
    notes ? `Additional Notes\n${notes}` : null,
  ].filter(Boolean);

  return {
    source_issue: {
      repo: sourceRepo,
      number: sourceIssue.number ?? null,
      title: rawTitle,
      url: normalizeString(sourceIssue.url) ?? null,
      ledger_revision: normalizeString(issue?.ledger_revision) ?? null,
    },
    raw_title: rawTitle,
    objective,
    project_context: projectContextParts.join("\n\n"),
    sections: {
      objective: objective,
      why_it_matters: whyItMatters,
      constraints,
      evidence,
      additional_notes: notes,
      maintainer_amendments: amendments.length > 0
        ? formatAmendments(amendments, { latestFirst: true })
        : null,
    },
    amendments,
  };
}

function extractNamedSections(body) {
  const recognizedKeys = new Set(["objective", "why_it_matters", "constraints", "evidence"]);
  const sections = {
    objective: "",
    why_it_matters: "",
    constraints: "",
    evidence: "",
  };
  const notes = [];
  let activeKey = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = matchHeading(line);

    if (heading) {
      const key = normalizeSectionName(heading.label);
      if (key && recognizedKeys.has(key)) {
        activeKey = key;
        if (heading.inlineValue) {
          appendLine(sections, key, heading.inlineValue);
        }
        continue;
      }
      activeKey = null;
    }

    if (activeKey) {
      appendLine(sections, activeKey, line);
      continue;
    }

    if (line.trim().length > 0) {
      notes.push(line);
    }
  }

  return {
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [key, normalizeBlock(value)]),
    ),
    notes: normalizeNotes(notes),
  };
}

function appendLine(target, key, line) {
  const nextValue = target[key].length > 0 ? `${target[key]}\n${line}` : line;
  target[key] = nextValue;
}

function matchHeading(line) {
  const markdownMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
  if (markdownMatch) {
    return {
      label: markdownMatch[1],
      inlineValue: "",
    };
  }

  const labelOnlyMatch = line.match(/^([A-Za-z][A-Za-z0-9 /-]{1,40}):\s*$/);
  if (labelOnlyMatch) {
    return {
      label: labelOnlyMatch[1],
      inlineValue: "",
    };
  }

  const inlineMatch = line.match(/^([A-Za-z][A-Za-z0-9 /-]{1,40}):\s+(.+)$/);
  if (inlineMatch) {
    return {
      label: inlineMatch[1],
      inlineValue: inlineMatch[2],
    };
  }

  return null;
}

function normalizeSectionName(value) {
  const normalized = normalizeString(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  switch (normalized) {
    case "objective":
      return "objective";
    case "why":
    case "why it matters":
    case "motivation":
      return "why_it_matters";
    case "constraints":
      return "constraints";
    case "evidence":
      return "evidence";
    default:
      return null;
  }
}

function normalizeNotes(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }
  return normalizeBlock(lines.join("\n"));
}

function normalizeBlock(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripSkillPrefix(value) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return null;
  }
  const stripped = trimmed.replace(/^\[skill\]\s*/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

function formatBulletList(items) {
  return items
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

function formatAmendments(amendments, options = {}) {
  const ordered = options.latestFirst ? [...amendments].reverse() : amendments;
  return ordered
    .map((amendment) => {
      const header = [
        normalizeString(amendment.author) ?? "unknown",
        amendment.recorded_at,
        normalizeString(amendment.url),
      ].filter(Boolean).join(" | ");
      const summary = amendment.thread_teaching_record
        ? `structured teaching: ${amendment.thread_teaching_record.kind} — ${amendment.thread_teaching_record.summary}`
        : normalizeString(amendment.body);
      if (!summary) {
        return null;
      }
      return [`- ${header}`, `  ${summary}`].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
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
    if (token === "--catalog-file") {
      options.catalogFile = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.input) {
    throw new Error("--input is required.");
  }
  return options;
}

async function readCatalogEntries(file) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => normalizeString(entry?.skill_id))
    .filter(Boolean)
    .map((entry) => entry.includes("/") ? entry.split("/").at(-1) : entry)
    .filter(Boolean);
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNonEmpty(...values) {
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
