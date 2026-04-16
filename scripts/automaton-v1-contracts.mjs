import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

export const CONTROL_SCHEMA_REFS = {
  verification_profile_catalog: "https://runx.ai/spec/verification-profile.schema.json",
  workspace_change_plan_request: "https://runx.ai/spec/workspace-change-plan-request.schema.json",
  issue_to_pr_request: "https://runx.ai/spec/issue-to-pr-request.schema.json",
  worker_request: "https://runx.ai/spec/worker-request.schema.json",
};

export function isPrereleaseEligibleTargetRepo(value) {
  const repo = firstString(value);
  return Boolean(repo) && /^nilstate\/[a-z0-9._-]+$/i.test(repo);
}

export function loadVerificationProfileCatalogSync(repoRoot = defaultRepoRoot) {
  const raw = readFileSync(
    path.join(path.resolve(repoRoot), "state", "verification-profiles.json"),
    "utf8",
  );
  return validateVerificationProfileCatalog(JSON.parse(raw));
}

export function validateVerificationProfileCatalog(value) {
  if (!isRecord(value)) {
    throw new Error(
      `verification profile catalog must match ${CONTROL_SCHEMA_REFS.verification_profile_catalog}.`,
    );
  }

  const version = firstString(value.version);
  if (version !== "runx.verification_profile_catalog.v1") {
    throw new Error(
      `verification profile catalog version must be 'runx.verification_profile_catalog.v1' (${CONTROL_SCHEMA_REFS.verification_profile_catalog}).`,
    );
  }

  const repoDefaults = asRecord(value.repo_defaults) ?? {};
  const profileRecords = asRecord(value.profiles);
  if (!profileRecords || Object.keys(profileRecords).length === 0) {
    throw new Error(
      `verification profile catalog must declare at least one profile (${CONTROL_SCHEMA_REFS.verification_profile_catalog}).`,
    );
  }

  const profiles = {};
  for (const [profileId, record] of Object.entries(profileRecords)) {
    if (!isRecord(record)) {
      throw new Error(`verification profile '${profileId}' must be an object.`);
    }

    const repo = requireString(record.repo, `profiles.${profileId}.repo`);
    const description = requireString(record.description, `profiles.${profileId}.description`);
    const commands = normalizeStringArray(record.commands, `profiles.${profileId}.commands`, {
      minLength: 1,
    });

    profiles[profileId] = {
      repo,
      description,
      commands,
    };
  }

  const normalizedDefaults = {};
  for (const [repo, profileIdValue] of Object.entries(repoDefaults)) {
    const profileId = requireString(profileIdValue, `repo_defaults.${repo}`);
    const profile = profiles[profileId];
    if (!profile) {
      throw new Error(`repo default for '${repo}' references unknown profile '${profileId}'.`);
    }
    if (profile.repo !== repo) {
      throw new Error(
        `repo default for '${repo}' must reference a profile declared for the same repo.`,
      );
    }
    normalizedDefaults[repo] = profileId;
  }

  return {
    version,
    repo_defaults: normalizedDefaults,
    profiles,
  };
}

export function normalizeWorkspaceChangePlanRequest(value, options = {}) {
  if (!isRecord(value)) {
    throw new Error(
      `workspace_change_plan_request must match ${CONTROL_SCHEMA_REFS.workspace_change_plan_request}.`,
    );
  }

  const targetRepo = firstString(options.targetRepo);
  if (targetRepo && !isPrereleaseEligibleTargetRepo(targetRepo)) {
    throw new Error(
      `workspace_change_plan_request target repo '${targetRepo}' is outside prerelease v1 scope.`,
    );
  }

  return {
    change_set_id: firstString(value.change_set_id) ?? null,
    objective: requireString(value.objective, "workspace_change_plan_request.objective"),
    project_context: requireString(
      value.project_context,
      "workspace_change_plan_request.project_context",
    ),
    target_surfaces: normalizeTargetSurfaces(value.target_surfaces),
    shared_invariants: normalizeStringArray(
      value.shared_invariants,
      "workspace_change_plan_request.shared_invariants",
    ),
    success_criteria: normalizeStringArray(
      value.success_criteria,
      "workspace_change_plan_request.success_criteria",
    ),
  };
}

export function normalizeWorkerRequest(value, options = {}) {
  if (!isRecord(value)) {
    throw new Error(`worker_request must match ${CONTROL_SCHEMA_REFS.worker_request}.`);
  }

  const worker = firstString(value.worker) ?? "issue-to-pr";
  if (worker !== "issue-to-pr") {
    throw new Error(`unsupported worker '${worker}'.`);
  }

  const issueToPrRequest = asRecord(value.issue_to_pr_request)
    ?? (worker === "issue-to-pr" ? asRecord(value.request) : undefined);
  if (!issueToPrRequest) {
    throw new Error(
      `worker_request.issue_to_pr_request is required (${CONTROL_SCHEMA_REFS.worker_request}).`,
    );
  }

  return {
    worker: "issue-to-pr",
    issue_to_pr_request: normalizeIssueToPrRequest(issueToPrRequest, options),
  };
}

export function collectWorkerValidationIssues(workerRequests, options = {}) {
  const accepted = [];
  const issues = [];

  for (const workerRequest of workerRequests) {
    try {
      accepted.push(normalizeWorkerRequest(workerRequest, options));
    } catch (error) {
      issues.push(error.message);
    }
  }

  return { accepted, issues };
}

export function normalizeIssueToPrRequest(value, options = {}) {
  if (!isRecord(value)) {
    throw new Error(
      `issue_to_pr_request must match ${CONTROL_SCHEMA_REFS.issue_to_pr_request}.`,
    );
  }

  const defaultRepo = firstString(options.defaultRepo);
  const targetRepo = firstString(value.target_repo) ?? defaultRepo;
  if (!targetRepo) {
    throw new Error("issue_to_pr_request.target_repo is required for prerelease v1.");
  }
  if (!isPrereleaseEligibleTargetRepo(targetRepo)) {
    throw new Error(
      `issue_to_pr_request target_repo '${targetRepo}' is outside prerelease v1 scope.`,
    );
  }

  const normalized = {
    task_id: firstString(value.task_id) ?? null,
    issue_title: requireString(value.issue_title, "issue_to_pr_request.issue_title"),
    issue_body: firstString(value.issue_body) ?? "",
    source: requireString(value.source, "issue_to_pr_request.source"),
    source_id: requireString(value.source_id, "issue_to_pr_request.source_id"),
    source_url: firstString(value.source_url) ?? null,
    target_repo: targetRepo,
    branch: firstString(value.branch) ?? null,
    size: normalizeOptionalEnum(value.size, ["micro", "small", "medium", "large"]) ?? "micro",
    risk: normalizeOptionalEnum(value.risk, ["low", "medium", "high"]) ?? "low",
    phase: firstString(value.phase) ?? "phase1",
    verification_profile: null,
  };

  if (options.catalog) {
    const verification = resolveVerificationPlan({
      catalog: options.catalog,
      targetRepo,
      issueToPrRequest: value,
    });
    normalized.verification_profile = verification.profile_id;
  }

  return normalized;
}

export function resolveVerificationPlan({ catalog, targetRepo, issueToPrRequest }) {
  const explicitProfileId = firstString(issueToPrRequest.verification_profile);
  const legacyCommands = collectLegacyValidationCommands(issueToPrRequest);

  if (explicitProfileId && legacyCommands.length > 0) {
    throw new Error(
      `issue_to_pr_request must use verification_profile or legacy validation commands, not both (${CONTROL_SCHEMA_REFS.issue_to_pr_request}).`,
    );
  }

  if (legacyCommands.length > 0) {
    const inferred = Object.entries(catalog.profiles).find(([, profile]) => {
      return profile.repo === targetRepo && stringArraysEqual(profile.commands, legacyCommands);
    });

    if (!inferred) {
      throw new Error(
        `raw validation_command fields are not allowed unless they map exactly to a declared verification profile (${CONTROL_SCHEMA_REFS.verification_profile_catalog}).`,
      );
    }

    return {
      profile_id: inferred[0],
      commands: inferred[1].commands,
      compatibility_mode: "legacy_validation_command_mapping",
    };
  }

  const profileId = explicitProfileId ?? catalog.repo_defaults[targetRepo];
  if (!profileId) {
    throw new Error(
      `no verification profile is declared for target repo '${targetRepo}' (${CONTROL_SCHEMA_REFS.verification_profile_catalog}).`,
    );
  }

  const profile = catalog.profiles[profileId];
  if (!profile) {
    throw new Error(`verification profile '${profileId}' is not defined.`);
  }
  if (profile.repo !== targetRepo) {
    throw new Error(
      `verification profile '${profileId}' is declared for '${profile.repo}', not '${targetRepo}'.`,
    );
  }

  return {
    profile_id: profileId,
    commands: profile.commands,
    compatibility_mode: "canonical",
  };
}

function collectLegacyValidationCommands(issueToPrRequest) {
  if (Array.isArray(issueToPrRequest.validation_commands)) {
    return normalizeStringArray(
      issueToPrRequest.validation_commands,
      "issue_to_pr_request.validation_commands",
    );
  }

  const single = firstString(issueToPrRequest.validation_command);
  return single ? [single] : [];
}

function normalizeTargetSurfaces(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("workspace_change_plan_request.target_surfaces must be an array.");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`target_surfaces[${index}] must be an object.`);
    }
    return {
      surface: requireString(entry.surface, `target_surfaces[${index}].surface`),
      kind: requireString(entry.kind, `target_surfaces[${index}].kind`),
      mutating: typeof entry.mutating === "boolean" ? entry.mutating : false,
      rationale: firstString(entry.rationale) ?? null,
    };
  });
}

function normalizeStringArray(value, label, options = {}) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  const values = value.map((entry, index) => {
    return requireString(entry, `${label}[${index}]`);
  });

  if ((options.minLength ?? 0) > values.length) {
    throw new Error(`${label} must contain at least ${options.minLength} value(s).`);
  }
  return values;
}

function normalizeOptionalEnum(value, allowed) {
  const candidate = firstString(value);
  if (!candidate) {
    return undefined;
  }
  if (!allowed.includes(candidate)) {
    throw new Error(`expected one of ${allowed.join(", ")}, got '${candidate}'.`);
  }
  return candidate;
}

function requireString(value, label) {
  const normalized = firstString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function isRecord(value) {
  return Boolean(asRecord(value));
}

function stringArraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
