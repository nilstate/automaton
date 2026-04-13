import { execFileSync } from "node:child_process";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = options.base ?? defaultBranch(options.repo);
  const existingPr = findExistingPr(options.repo, options.branch);

  if (!hasWorkingTreeChanges()) {
    if (options.closeExistingIfNoop && existingPr) {
      closePr(
        options.repo,
        existingPr.number,
        "Closing stale automaton PR because the latest run produced no repo changes.",
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "closed_noop",
            reason: "working tree clean",
            pr_number: existingPr.number,
            pr_url: existingPr.url,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "noop",
          reason: "working tree clean",
          pr_number: existingPr?.number ?? null,
          pr_url: existingPr?.url ?? null,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  run("git", ["checkout", "-B", options.branch]);
  run("git", ["add", "-A"]);

  if (!hasStagedChanges()) {
    if (options.closeExistingIfNoop && existingPr) {
      closePr(
        options.repo,
        existingPr.number,
        "Closing stale automaton PR because the latest run produced no staged changes.",
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "closed_noop",
            reason: "no staged changes",
            pr_number: existingPr.number,
            pr_url: existingPr.url,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "noop",
          reason: "no staged changes",
          pr_number: existingPr?.number ?? null,
          pr_url: existingPr?.url ?? null,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  run("git", ["commit", "-m", options.commitMessage]);
  run("git", ["push", "-u", "origin", options.branch, "--force-with-lease"]);

  let pr = findExistingPr(options.repo, options.branch);
  if (!pr) {
    run("gh", [
      "pr",
      "create",
      "--repo",
      options.repo,
      "--draft",
      "--base",
      base,
      "--head",
      options.branch,
      "--title",
      options.title,
      "--body-file",
      options.bodyFile,
    ]);
    pr = findExistingPr(options.repo, options.branch);
  }

  if (!pr) {
    throw new Error(`Could not resolve the published pull request for branch ${options.branch}.`);
  }

  if (options.issueNumber) {
    run("gh", [
      "issue",
      "comment",
      options.issueNumber,
      "--repo",
      options.issueRepo ?? options.repo,
      "--body",
      `Opened draft PR for this run: ${pr.url}`,
    ]);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "published",
        branch: options.branch,
        base,
        pr_number: pr.number,
        pr_url: pr.url,
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--branch") {
      options.branch = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--title") {
      options.title = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--commit-message") {
      options.commitMessage = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--body-file") {
      options.bodyFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--base") {
      options.base = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-number") {
      options.issueNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-repo") {
      options.issueRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--close-existing-if-noop") {
      options.closeExistingIfNoop = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  for (const required of ["repo", "branch", "title", "commitMessage", "bodyFile"]) {
    if (!options[required]) {
      throw new Error(`--${required.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required.`);
    }
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

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasWorkingTreeChanges() {
  return run("git", ["status", "--porcelain"]).trim().length > 0;
}

function hasStagedChanges() {
  try {
    run("git", ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

function defaultBranch(repo) {
  const report = JSON.parse(
    run("gh", ["repo", "view", repo, "--json", "defaultBranchRef"]),
  );
  return report.defaultBranchRef.name;
}

function findExistingPr(repo, branch) {
  const listing = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,url",
    ]),
  );
  return listing[0];
}

function closePr(repo, number, comment) {
  run("gh", [
    "pr",
    "close",
    String(number),
    "--repo",
    repo,
    "--comment",
    comment,
  ]);
}

await main();
