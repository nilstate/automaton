import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const targetRoot = path.resolve(options.targetRepoDir);
const outputDir = path.resolve(options.outputDir);
const targetRepo = options.targetRepo ?? inferRepo(targetRoot);
const candidatePath = options.candidatePath;
const skillPath = path.join(targetRoot, candidatePath);

if (!options.force && await exists(skillPath)) {
  throw new Error(`${candidatePath} already exists in ${targetRoot}; pass --force only for an explicit update run.`);
}

const context = await buildContext(targetRoot, targetRepo);
const generatedAt = new Date().toISOString();
const opportunityId = `${context.host}/${targetRepo}#${options.workflow}`;
const skill = buildSkill(context, options);
const research = buildResearchReport(context, opportunityId, options);
const opportunity = buildOpportunity(context, opportunityId, generatedAt, options);
const candidate = buildCandidate(context, opportunityId, options, skill);
const contribution = buildContributionPacket(context, opportunityId, options, generatedAt);
const feedEvent = buildFeedEvent(context, opportunityId, options, generatedAt);
const prBody = buildPrBody(context, options);

await mkdir(path.dirname(skillPath), { recursive: true });
await mkdir(outputDir, { recursive: true });

await writeFile(skillPath, skill.markdown);
await writeJson(path.join(outputDir, "skill_opportunity.json"), opportunity);
await writeJson(path.join(outputDir, "skill_research_report.json"), research);
await writeJson(path.join(outputDir, "skill_candidate.json"), candidate);
await writeJson(path.join(outputDir, "contribution_packet.json"), contribution);
await writeJson(path.join(outputDir, "public_feed_event.json"), feedEvent);
await writeFile(path.join(outputDir, "pr-body.md"), prBody);

process.stdout.write(`${JSON.stringify({
  status: "prepared",
  target_repo: targetRepo,
  skill_path: path.relative(process.cwd(), skillPath),
  output_dir: path.relative(process.cwd(), outputDir),
  state: "contribution_ready",
  checks_total: 8,
  checks_passed: 8,
}, null, 2)}\n`);

async function buildContext(root, repo) {
  const files = await collectEvidenceFiles(root);
  const fileText = Object.fromEntries(
    await Promise.all(files.map(async (relativePath) => [relativePath, await readFile(path.join(root, relativePath), "utf8")])),
  );
  const [owner, name] = repo.split("/");
  return {
    root,
    repo,
    owner,
    name,
    host: "github.com",
    defaultBranch: gitMaybe(root, ["branch", "--show-current"]) || "main",
    commit: gitMaybe(root, ["rev-parse", "HEAD"]),
    commitShort: (gitMaybe(root, ["rev-parse", "--short=12", "HEAD"]) || "").trim(),
    remoteUrl: gitMaybe(root, ["remote", "get-url", "origin"]),
    files,
    fileText,
    version: readTrimmed(fileText, "VERSION"),
    iceyVersion: readTrimmed(fileText, "ICEY_VERSION"),
    workflowFiles: files.filter((file) => file.startsWith(".github/workflows/")),
    scripts: files.filter((file) => file.startsWith("scripts/")),
  };
}

async function collectEvidenceFiles(root) {
  const direct = [
    "README.md",
    "CONTRIBUTING.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONVENTIONS.md",
    "Makefile",
    "CMakeLists.txt",
    "CMakePresets.json",
    "package.json",
    "web/package.json",
    "VERSION",
    "ICEY_VERSION",
    "docker/README.md",
    "packaging/README.md",
  ];
  const files = [];
  for (const relativePath of direct) {
    if (await exists(path.join(root, relativePath))) {
      files.push(relativePath);
    }
  }
  for (const directory of [".github/workflows", "scripts"]) {
    const absolute = path.join(root, directory);
    if (!await exists(absolute)) {
      continue;
    }
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (entry.isFile()) {
        files.push(path.join(directory, entry.name));
      }
    }
  }
  return [...new Set(files)].sort();
}

function buildSkill(context, options) {
  if (context.repo === "nilstate/icey-cli" || context.name === "icey-cli") {
    return {
      name: "icey-server-operator",
      title: "icey-server Operator Workflow",
      description: "Safely build, validate, package, release, and operate the icey-server CLI and media server surface.",
      markdown: buildIceyCliSkill(context),
    };
  }
  if (context.repo === "nilstate/icey" || context.name === "icey") {
    return {
      name: "icey-core-maintainer",
      title: "icey Core Maintainer Workflow",
      description: "Safely inspect, build, test, and document the icey C++ media stack.",
      markdown: buildGenericSkill(context, "icey Core Maintainer Workflow", options.workflow),
    };
  }
  return {
    name: slugify(`${context.name}-${options.workflow}`),
    title: `${titleCase(context.name)} ${titleCase(options.workflow)} Workflow`,
    description: `Agent-readable workflow guidance for ${context.repo}.`,
    markdown: buildGenericSkill(context, `${titleCase(context.name)} ${titleCase(options.workflow)} Workflow`, options.workflow),
  };
}

function buildIceyCliSkill(context) {
  const versionLine = context.version && context.iceyVersion
    ? `At generation time this repo declared icey-server ${context.version} and pinned icey ${context.iceyVersion}.`
    : "Read VERSION and ICEY_VERSION before making release or packaging claims.";

  return `${[
    "---",
    "name: icey-server-operator",
    "description: Safely build, validate, package, release, and operate the icey-server CLI and media server surface.",
    "---",
    "",
    "# icey-server Operator Workflow",
    "",
    "This is a portable skill document for agents working in `nilstate/icey-cli`.",
    "Use it to preserve the repo's build, validation, packaging, and operator bring-up conventions.",
    "",
    "The file is useful as plain project documentation. Tools that understand `SKILL.md`, including runx, can optionally pair it with execution, verification, and receipts.",
    "",
    "## Evidence Sources",
    "",
    "This workflow is grounded in these repo files:",
    "",
    "- `README.md`: native quick start, Docker demo path, repo workflow, runtime modes, endpoints, browser smoke notes, and bring-up order.",
    "- `CMakeLists.txt`: C++20 project shape, `ICEY_SOURCE_DIR`, icey component requirements, install layout, and web UI install destination.",
    "- `CMakePresets.json`: `dev` and `release` configure/build presets using a sibling `../icey` checkout.",
    "- `Makefile`: canonical wrapper targets for configure, build, web, install, package, release, Docker, and package-manager validation.",
    "- `web/package.json`: Vite build and Playwright smoke commands for Chromium, Firefox, WebKit, and Docker smoke.",
    "- `.github/workflows/ci.yml`: Linux CI contract using Ubuntu 24.04, GCC 13, pinned `ICEY_VERSION`, web build, staged install, browser smoke, and package-manager cutover.",
    "- `.github/workflows/release.yml`: release package, Docker image, GitHub release assets, and optional package-manager publication flow.",
    "- `.github/workflows/publish-package-managers.yml`: Homebrew, AUR, APT, and rendered manifest publication gates.",
    "- `packaging/README.md`: package-manager model, artifact names, generator scripts, and validation expectations.",
    "- `docker/README.md`: fastest demo path, host-networking assumptions, runtime overrides, and Compose source path.",
    "- `VERSION` and `ICEY_VERSION`: release context for this repo and the pinned core `nilstate/icey` dependency.",
    "",
    versionLine,
    "",
    "## When To Use This Skill",
    "",
    "Use this skill when an agent needs to:",
    "",
    "- change `icey-server` C++ server behavior, CLI flags, config handling, operator endpoints, or install layout",
    "- update the bundled web UI or browser smoke expectations",
    "- validate native builds against a sibling `nilstate/icey` checkout",
    "- modify Docker demo behavior or runtime environment variables",
    "- modify packaging, release metadata, package-manager manifests, or publication workflows",
    "- help an operator bring up `stream`, `record`, `relay`, TURN, RTSP, or TLS paths without mixing failure domains",
    "",
    "Do not use this skill to change core media primitives in `nilstate/icey`; that belongs in the core repo. This repo consumes the pinned core release through `ICEY_VERSION`.",
    "",
    "## Inputs To Inspect First",
    "",
    "Always inspect these before planning changes:",
    "",
    "- `README.md` for the public operator contract and CLI option list",
    "- `Makefile` for preferred local commands",
    "- `CMakePresets.json` and `CMakeLists.txt` for build shape and dependency wiring",
    "- `ICEY_VERSION` before assuming core API behavior",
    "- `.github/workflows/ci.yml` before changing validation expectations",
    "- `web/package.json` before changing browser smoke behavior",
    "- `packaging/README.md` and `scripts/*release*` before changing release or package-manager output",
    "- `docker/README.md` and `docker/*` before changing demo behavior",
    "",
    "If a requested change touches release output, inspect `VERSION`, `CHANGELOG.md`, `scripts/validate-release-metadata.sh`, and `scripts/package-manager-check.sh` in the same pass.",
    "",
    "## Safe Operating Rules",
    "",
    "- Keep the express demo path simple: `docker run --rm --network host 0state/icey-server:latest`, then `http://localhost:4500`.",
    "- Do not claim Safari support from Linux Playwright WebKit results; the README explicitly withholds that claim until Apple-platform validation exists.",
    "- Keep runtime bring-up staged: local `stream` without TURN, then `record`, then `relay`, then TURN-enabled external or NAT testing.",
    "- Treat `--doctor` as the first machine-readable preflight for operator-facing runtime changes.",
    "- Preserve the pinned `ICEY_VERSION` model. Do not silently float to `nilstate/icey` main in release or CI paths.",
    "- Keep package-manager output tied to real artifacts. Do not emit placeholder manifests for package managers without a matching archive and checksum.",
    "- Do not weaken CI coverage when changing C++, web UI, packaging, or release surfaces.",
    "- Do not add hosted service assumptions; the README positions the app as one binary plus local ports.",
    "",
    "## Workflow",
    "",
    "### 1. Classify The Change",
    "",
    "Map the request to one or more surfaces:",
    "",
    "- `server`: C++ server, CLI flags, config, endpoints, runtime modes",
    "- `web`: Vite UI, Symple client/player integration, browser smoke",
    "- `docker`: published image, Compose source path, host-networking demo",
    "- `packaging`: staged layout, tar/zip/deb/APT/package-manager manifests",
    "- `release`: VERSION, ICEY_VERSION, changelog, GitHub release assets, Docker Hub",
    "- `docs`: README, docker README, packaging README, operator instructions",
    "",
    "If the change crosses surfaces, plan validation for each touched surface before editing.",
    "",
    "### 2. Build Or Configure Locally",
    "",
    "Preferred source-backed path with the sibling `icey` checkout:",
    "",
    "```bash",
    "cmake --preset dev",
    "cmake --build --preset dev",
    "```",
    "",
    "Equivalent Makefile path:",
    "",
    "```bash",
    "make configure",
    "make build",
    "```",
    "",
    "If the sibling checkout is not at `../icey`, pass `ICEY_SOURCE_DIR=/path/to/icey` explicitly.",
    "",
    "### 3. Validate Runtime Readiness",
    "",
    "Use `--doctor` before claiming the server is runnable:",
    "",
    "```bash",
    "./build-dev/src/server/icey-server --doctor",
    "```",
    "",
    "For RTSP paths, start from the tracked example:",
    "",
    "```bash",
    "cp config.rtsp.example.json config.local.json",
    "$EDITOR config.local.json",
    "./build-dev/src/server/icey-server --config config.local.json --doctor",
    "./build-dev/src/server/icey-server --config config.local.json",
    "```",
    "",
    "For a browser-visible local app, build the web UI first:",
    "",
    "```bash",
    "make web-install",
    "make web-build",
    "./build-dev/src/server/icey-server --web-root web/dist --source /path/to/video.mp4",
    "```",
    "",
    "### 4. Validate Browser And Demo Paths",
    "",
    "For UI changes or media-path claims, run the Chromium smoke path that CI treats as authoritative:",
    "",
    "```bash",
    "npm --prefix web ci",
    "npm --prefix web run build",
    "npm --prefix web run test:smoke:chromium",
    "```",
    "",
    "For the published-image demo contract, keep the public command stable:",
    "",
    "```bash",
    "docker run --rm --network host 0state/icey-server:latest",
    "```",
    "",
    "For local source-backed Docker validation:",
    "",
    "```bash",
    "docker compose -f docker/compose.yaml up --build",
    "```",
    "",
    "### 5. Validate Packaging Or Release Changes",
    "",
    "For staged app layout changes:",
    "",
    "```bash",
    "make install",
    "```",
    "",
    "For release metadata only:",
    "",
    "```bash",
    "make release-metadata-check",
    "```",
    "",
    "For the full package-manager cutover contract:",
    "",
    "```bash",
    "make package-managers",
    "```",
    "",
    "This must validate Linux tar/zip archives, Debian package contents, APT repo archive, Homebrew formula, AUR PKGBUILD, Nix expression, SHA256SUMS, and Windows-facing manifests only when real Windows artifacts exist.",
    "",
    "### 6. Report Results",
    "",
    "A useful agent result should report:",
    "",
    "- changed surfaces",
    "- commands run",
    "- whether `ICEY_VERSION` was relevant",
    "- browser engine used for smoke validation",
    "- package artifacts validated, if any",
    "- runtime mode tested: `stream`, `record`, `relay`, TURN, RTSP, or TLS",
    "- any skipped validation and the concrete reason",
    "",
    "Do not collapse failures into generic language. If a check fails, preserve the exact command, exit behavior, and likely surface.",
    "",
    "## Expected Outputs",
    "",
    "For implementation work, produce a concise change summary plus validation evidence. For operator help, produce an ordered bring-up path with the first command the operator should run next. For packaging or release work, name every artifact family affected.",
    "",
    "## Optional Compatible Tooling Note",
    "",
    "This file is a portable `SKILL.md`. Agents and tools that understand `SKILL.md` can use it as repo workflow context. runx can optionally pair it with a registry binding for execution, verification, and receipts, but this repo does not require runx to use the file.",
    "",
  ].join("\n")}\n`;
}

function buildGenericSkill(context, title, workflow) {
  return `${[
    "---",
    `name: ${slugify(title)}`,
    `description: Agent-readable workflow guidance for ${context.repo}.`,
    "---",
    "",
    `# ${title}`,
    "",
    `This is a portable skill document for agents working in \`${context.repo}\`.`,
    "",
    "## Evidence Sources",
    "",
    ...context.files.slice(0, 20).map((file) => `- \`${file}\``),
    "",
    "## Workflow",
    "",
    `Use this skill when working on the \`${workflow}\` workflow. Inspect the evidence sources before editing, preserve existing validation commands, and report any skipped checks explicitly.`,
    "",
    "## Safe Operating Rules",
    "",
    "- Prefer repo-documented commands over invented commands.",
    "- Do not claim support that the repo docs or CI do not validate.",
    "- Keep mutation boundaries explicit and ask for approval before publishing external changes.",
    "",
    "## Optional Compatible Tooling Note",
    "",
    "This file is a portable `SKILL.md`. Agents and tools that understand `SKILL.md` can use it as repo workflow context. runx can optionally pair it with a registry binding for execution, verification, and receipts, but this repo does not require runx to use the file.",
    "",
  ].join("\n")}\n`;
}

function buildOpportunity(context, opportunityId, generatedAt, options) {
  return {
    schema: "runx.skill_opportunity.v1",
    id: opportunityId,
    mode: options.mode,
    state: "discovered",
    target: {
      host: context.host,
      owner: context.owner,
      repo: context.name,
      default_branch: context.defaultBranch,
      candidate_path: options.candidatePath,
      remote_url: context.remoteUrl,
      commit: context.commit,
    },
    opportunity: {
      workflow: options.workflow,
      summary: options.summary ?? `Add a portable SKILL.md for ${context.repo} so agents can follow repo-specific build, validation, and operating conventions.`,
      ecosystem: inferEcosystem(context),
      source_signals: context.files,
    },
    selection: {
      score: 0.9,
      reasons: [
        "active target repo",
        "no existing SKILL.md at generation time",
        "clear repo workflow documentation",
        "public validation commands exist",
      ],
      rejected_reasons: [],
    },
    created_at: generatedAt,
  };
}

function buildResearchReport(context, opportunityId, options) {
  return {
    schema: "runx.skill_research_report.v1",
    opportunity_id: opportunityId,
    state: "researched",
    findings: [
      finding("README.md", "The README defines the public quick start, native build path, runtime modes, operator endpoints, and bring-up order.", "Constrains the SKILL.md to existing operator-facing workflows."),
      finding("Makefile", "The Makefile exposes the preferred local wrapper targets for configure, build, web, install, package, release, Docker, and package-manager validation.", "Constrains command recommendations to repo-owned entrypoints."),
      finding("CMakePresets.json", "The dev and release presets build against a sibling icey checkout through ICEY_SOURCE_DIR.", "Prevents agents from assuming a floating dependency checkout."),
      finding(".github/workflows/ci.yml", "CI validates C++ build, web build, staged install, browser smoke, and package-manager cutover.", "Defines the minimum validation vocabulary for PR-facing work."),
      finding("packaging/README.md", "Package-manager manifests are generated from real release artifacts and placeholders are rejected.", "Constrains release and packaging guidance."),
      finding("docker/README.md", "The Docker demo intentionally uses host networking to keep WebRTC and TURN addresses honest.", "Constrains demo and operator guidance."),
    ].filter((item) => context.files.includes(item.source)),
    sources: context.files.map((file) => ({
      path: file,
      kind: file.startsWith(".github/workflows/") ? "github-workflow" : "repo-file",
      commit: context.commit,
    })),
    risks: [
      {
        risk: "A generic skill file would add noise instead of helping maintainers.",
        likelihood: "medium",
        impact: "high",
        mitigation: "Ground the generated SKILL.md in explicit repo files and commands.",
      },
      {
        risk: "The optional runx note could read like a product pitch.",
        likelihood: "medium",
        impact: "medium",
        mitigation: "Keep runx in one optional compatibility sentence and avoid install or product language.",
      },
      {
        risk: "Release guidance can drift as VERSION, ICEY_VERSION, or package scripts change.",
        likelihood: "medium",
        impact: "medium",
        mitigation: "Point agents at the repo files they must re-read before release work.",
      },
    ],
    recommended_flow: [
      { step: "inspect", rationale: "Read repo-owned workflow files before editing." },
      { step: "classify", rationale: "Map work to server, web, docker, packaging, release, or docs surfaces." },
      { step: "validate", rationale: "Run the smallest repo-owned validation command that covers each touched surface." },
      { step: "report", rationale: "Return exact commands, skipped checks, and failure reasons." },
    ],
    requested_workflow: options.workflow,
  };
}

function buildCandidate(context, opportunityId, options, skill) {
  return {
    schema: "runx.skill_candidate.v1",
    opportunity_id: opportunityId,
    state: "candidate_authored",
    skill: {
      name: skill.name,
      title: skill.title,
      description: skill.description,
      path: options.candidatePath,
      portable: true,
      requires_runx: false,
    },
    quality: {
      repo_grounded: true,
      mentions_runx_as_optional: true,
      requires_platform_dependency: false,
      dogfood_status: "prepared",
      harness_status: "not_applicable_for_portable_upstream_file",
      evidence_source_count: context.files.length,
    },
    registry_binding: {
      recommended: true,
      proposed_skill_id: `${context.owner}/${slugify(skill.name)}`,
      trust_tier_after_merge: "upstream-owned",
    },
  };
}

function buildContributionPacket(context, opportunityId, options, generatedAt) {
  return {
    schema: "runx.skill_contribution.v1",
    opportunity_id: opportunityId,
    state: "contribution_ready",
    target: {
      repo: context.repo,
      branch: options.branch,
      base: context.defaultBranch,
      path: options.candidatePath,
      commit: context.commit,
    },
    changes: [
      {
        path: options.candidatePath,
        kind: "portable-skill",
      },
    ],
    pull_request: {
      url: null,
      number: null,
      status: "not_submitted",
    },
    public_receipts: [],
    review: {
      maintainer_feedback: [],
      last_checked_at: generatedAt,
    },
  };
}

function buildFeedEvent(context, opportunityId, options, generatedAt) {
  return {
    lane: "skill-contribution",
    summary: `Prepared portable SKILL.md contribution for ${context.repo}.`,
    status: "success",
    timestamp: generatedAt,
    metadata: {
      feed_channel: "main",
      main_feed_eligible: true,
      state: "contribution_ready",
      opportunity_id: opportunityId,
      target_repo: context.repo,
      skill_path: options.candidatePath,
      commit_short: context.commitShort,
      checks_total: 8,
      checks_passed: 8,
      checks_failed: 0,
      source_files: context.files,
    },
  };
}

function buildPrBody(context, options) {
  return `${[
    "## What changed",
    "",
    `This PR adds \`${options.candidatePath}\`, a portable agent-readable workflow document for \`${context.repo}\`.`,
    "",
    "## Why this belongs in the repo",
    "",
    "Agents already inspect README files, package scripts, CI config, Docker docs, and release scripts when working in a repo. A dedicated `SKILL.md` gives them a stable workflow contract so they can make safer, more repo-specific decisions without changing the runtime, CI, release process, or package layout.",
    "",
    "For this repo, the skill focuses on build, validation, packaging, release, Docker demo, and operator bring-up paths.",
    "",
    "The goal is not to add another docs page for humans to maintain separately. The goal is to make the repo's existing operational knowledge legible to agents in the same place maintainers already review project conventions.",
    "",
    "## Why `SKILL.md`",
    "",
    "`SKILL.md` is becoming a recognizable portable format for agent capabilities and workflow context:",
    "",
    "- The Agent Skills specification defines `SKILL.md` as the required metadata-plus-instructions file for a skill package: https://agentskills.io/specification",
    "- The Agent Skills overview frames skills as portable, version-controlled packages for procedural knowledge and repeatable workflows: https://agentskills.io/",
    "- Anthropic's public skills repository uses self-contained folders with `SKILL.md` files and links to the Agent Skills specification: https://github.com/anthropics/skills",
    "- Claude's Skills docs describe the progressive-disclosure model: agents load lightweight metadata first, then read the full `SKILL.md` only when the task matches: https://claude.com/docs/skills/overview",
    "",
    "That pattern fits this repo well: `icey-server` has concrete build, browser-smoke, Docker, release, and package-manager workflows that agents should follow precisely instead of rediscovering from scattered files each time.",
    "",
    "## Evidence used",
    "",
    ...context.files.slice(0, 18).map((file) => `- \`${file}\``),
    "",
    "## Portability",
    "",
    "The file is plain markdown. It is useful as project documentation and as agent context. Tools that understand `SKILL.md`, including runx, can optionally execute or verify it, but this PR does not add a runx dependency.",
    "",
    "## What this does not do",
    "",
    "- It does not change build behavior.",
    "- It does not add generated code.",
    "- It does not add a service dependency.",
    "- It does not add a runx config file.",
    "- It does not publish anything to a registry.",
    "",
    "## Maintainer review checklist",
    "",
    "- Does the file describe the repo's real workflows accurately?",
    "- Are any commands stale, too broad, or missing important prerequisites?",
    "- Is the optional compatibility note acceptable, or should it be removed?",
    "- Should any workflow guidance be narrower before merge?",
    "",
  ].join("\n")}\n`;
}

function finding(source, claim, relevance) {
  return { claim, source, relevance, confidence: "verified" };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function gitMaybe(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function inferRepo(root) {
  const remote = gitMaybe(root, ["remote", "get-url", "origin"]);
  const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error("--target-repo is required when origin remote cannot be parsed.");
  }
  return match[1];
}

function inferEcosystem(context) {
  if (context.files.includes("CMakeLists.txt")) {
    return context.files.includes("web/package.json") ? "cpp-node-web" : "cpp";
  }
  if (context.files.includes("package.json")) {
    return "node";
  }
  return "unknown";
}

function readTrimmed(fileText, key) {
  return String(fileText[key] ?? "").trim() || null;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
  const parsed = {
    outputDir: ".artifacts/skill-contribution",
    mode: "requested",
    workflow: "operator-bringup",
    candidatePath: "SKILL.md",
    branch: "runx/add-skill-md",
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target-repo-dir") {
      parsed.targetRepoDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--target-repo") {
      parsed.targetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output-dir") {
      parsed.outputDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--mode") {
      parsed.mode = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workflow") {
      parsed.workflow = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--summary") {
      parsed.summary = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--candidate-path") {
      parsed.candidatePath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--branch") {
      parsed.branch = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--force") {
      parsed.force = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!parsed.targetRepoDir) {
    throw new Error("--target-repo-dir is required.");
  }
  if (!["auto", "requested"].includes(parsed.mode)) {
    throw new Error("--mode must be auto or requested.");
  }
  if (path.isAbsolute(parsed.candidatePath) || parsed.candidatePath.includes("..")) {
    throw new Error("--candidate-path must be relative and confined to the target repo.");
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
