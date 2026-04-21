import path from "node:path";

const surfaceOrder = [
  "doctrine",
  "learned_state",
  "public_history",
  "reflections",
  "public_face",
  "working_docs",
  "automation_runtime",
  "repo_meta",
  "other",
];

export function classifyRepoPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (normalized === "doctrine" || normalized.startsWith("doctrine/")) {
    return "doctrine";
  }
  if (
    normalized === ".ai"
    || normalized === ".ai/config.yaml"
    || normalized === ".ai/specs"
    || normalized.startsWith(".ai/specs/")
    || normalized === ".ai/reviews"
    || normalized.startsWith(".ai/reviews/")
  ) {
    return "repo_meta";
  }
  if (normalized === "state" || normalized.startsWith("state/")) {
    return "learned_state";
  }
  if (normalized === "history" || normalized.startsWith("history/")) {
    return "public_history";
  }
  if (normalized === "reflections" || normalized.startsWith("reflections/")) {
    return "reflections";
  }
  if (normalized === "site" || normalized.startsWith("site/")) {
    return "public_face";
  }
  if (normalized === "docs" || normalized.startsWith("docs/")) {
    return "working_docs";
  }
  if (
    normalized === "scripts"
    || normalized.startsWith("scripts/")
    || normalized === ".github"
    || normalized.startsWith(".github/")
    || normalized === "schemas"
    || normalized.startsWith("schemas/")
    || normalized === "spec"
    || normalized.startsWith("spec/")
  ) {
    return "automation_runtime";
  }
  if ([
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONVENTIONS.md",
    "package.json",
    "package-lock.json",
    ".gitignore",
  ].includes(normalized)) {
    return "repo_meta";
  }
  return "other";
}

export function summarizeChangeSurfaces(files = []) {
  const normalizedFiles = Array.isArray(files)
    ? files.map((file) => normalizeRepoPath(file)).filter(Boolean)
    : [];
  const files_by_surface = Object.fromEntries(surfaceOrder.map((surface) => [surface, []]));
  for (const file of normalizedFiles) {
    files_by_surface[classifyRepoPath(file)].push(file);
  }
  const surface_counts = Object.fromEntries(
    surfaceOrder.map((surface) => [surface, files_by_surface[surface].length]),
  );
  const surfaces = surfaceOrder.filter((surface) => surface_counts[surface] > 0);
  return {
    files: normalizedFiles,
    surfaces,
    surface_counts,
    files_by_surface,
  };
}

export function evaluateLaneChangeSurfacePolicy({
  lane,
  repo,
  ownerRepo = process.env.GITHUB_REPOSITORY || "nilstate/aster",
  files = [],
}) {
  const summary = summarizeChangeSurfaces(files);
  const normalizedLane = String(lane ?? "").trim();
  const internalRepo = String(repo ?? "").trim() === String(ownerRepo ?? "").trim();
  const reasons = [];

  if (!internalRepo) {
    return {
      status: "report_only",
      lane: normalizedLane,
      repo,
      owner_repo: ownerRepo,
      internal_repo: false,
      allowed_surfaces: [],
      blocked_surfaces: [],
      ...summary,
      reasons,
    };
  }

  if (summary.surface_counts.doctrine > 0) {
    reasons.push("doctrine_surface_requires_human_review");
  }

  const allowedSurfaces = allowedSurfacesForLane(normalizedLane);
  for (const surface of summary.surfaces) {
    if (!allowedSurfaces.has(surface)) {
      reasons.push(`surface_not_allowed:${surface}`);
    }
  }

  return {
    status: reasons.length > 0 ? "blocked" : "allowed",
    lane: normalizedLane,
    repo,
    owner_repo: ownerRepo,
    internal_repo: true,
    allowed_surfaces: [...allowedSurfaces],
    blocked_surfaces: summary.surfaces.filter((surface) => !allowedSurfaces.has(surface)),
    ...summary,
    reasons,
  };
}

export function renderChangeSurfacePolicyLines(policy) {
  const surfaces = (policy?.surfaces ?? []).map((surface) => `\`${surface}\``).join(", ") || "`none`";
  const lines = [
    "## Change Surface Policy",
    "",
    `- Repo scope: ${policy?.internal_repo ? "`aster` parity enforced" : "`external` report-only"}`,
    `- Policy status: \`${policy?.status ?? "unknown"}\``,
    `- Surfaces touched: ${surfaces}`,
  ];
  if (Array.isArray(policy?.reasons) && policy.reasons.length > 0) {
    lines.push(`- Reasons: ${policy.reasons.map((reason) => `\`${reason}\``).join(", ")}`);
  }
  return lines;
}

function allowedSurfacesForLane(lane) {
  switch (lane) {
    case "issue-triage":
      return new Set([
        "learned_state",
        "public_history",
        "reflections",
        "public_face",
        "working_docs",
        "automation_runtime",
        "repo_meta",
        "other",
      ]);
    case "evidence-projection-derive":
      return new Set(["learned_state", "public_history", "reflections", "repo_meta"]);
    case "thread-teaching-derive":
      return new Set(["learned_state", "repo_meta"]);
    case "docs-pr":
      return new Set(["working_docs", "public_face", "repo_meta"]);
    case "skill-lab":
      return new Set(["working_docs", "repo_meta"]);
    case "fix-pr":
      return new Set(["automation_runtime", "working_docs", "public_face", "repo_meta", "other"]);
    case "skill-upstream":
      return new Set(["working_docs", "repo_meta", "other"]);
    default:
      return new Set(["automation_runtime", "working_docs", "public_face", "repo_meta", "other"]);
  }
}

function normalizeRepoPath(filePath) {
  return String(filePath ?? "")
    .trim()
    .replaceAll(path.sep, "/")
    .replace(/^\.\/+/, "");
}
