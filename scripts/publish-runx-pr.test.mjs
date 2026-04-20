import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCheckoutArgs,
  buildPushArgs,
  currentBranchName,
  ensureRemoteLease,
  normalizePublishBranchName,
} from "./publish-runx-pr.mjs";

test("ensureRemoteLease fetches the remote automation branch before pushing", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "ls-remote") {
      return "abc123\trefs/heads/runx/operator-memory-issue-triage-pr-8\n";
    }
    if (args[0] === "fetch") {
      return "";
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };

  const lease = ensureRemoteLease("runx/operator-memory-issue-triage-pr-8", runner);

  assert.equal(lease, "abc123");
  assert.deepEqual(calls, [
    ["git", ["ls-remote", "--heads", "origin", "runx/operator-memory-issue-triage-pr-8"]],
    [
      "git",
      [
        "fetch",
        "--no-tags",
        "origin",
        "runx/operator-memory-issue-triage-pr-8:refs/remotes/origin/runx/operator-memory-issue-triage-pr-8",
      ],
    ],
  ]);
});

test("ensureRemoteLease returns null when the remote branch does not exist", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "ls-remote") {
      return "\n";
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };

  const lease = ensureRemoteLease("runx/generated-docs-pr", runner);

  assert.equal(lease, null);
  assert.deepEqual(calls, [["git", ["ls-remote", "--heads", "origin", "runx/generated-docs-pr"]]]);
});

test("buildCheckoutArgs reuses the remote branch tip without rewriting origin", () => {
  assert.deepEqual(buildCheckoutArgs("runx/generated-docs-pr", "abc123"), [
    "checkout",
    "-B",
    "runx/generated-docs-pr",
    "refs/remotes/origin/runx/generated-docs-pr",
  ]);
});

test("buildCheckoutArgs creates a fresh branch when no remote tip exists", () => {
  assert.deepEqual(buildCheckoutArgs("runx/generated-docs-pr", null), [
    "checkout",
    "-B",
    "runx/generated-docs-pr",
  ]);
});

test("buildPushArgs uses a non-destructive fast-forward push when a remote tip is known", () => {
  assert.deepEqual(buildPushArgs("runx/generated-docs-pr", "abc123"), [
    "push",
    "-u",
    "origin",
    "runx/generated-docs-pr",
  ]);
});

test("buildPushArgs uses the same non-destructive push shape for new branches", () => {
  assert.deepEqual(buildPushArgs("runx/generated-docs-pr", null), [
    "push",
    "-u",
    "origin",
    "runx/generated-docs-pr",
  ]);
});

test("currentBranchName reads the currently checked out branch", () => {
  const branch = currentBranchName((command, args) => {
    assert.equal(command, "git");
    assert.deepEqual(args, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return "runx/evidence-projection-derive\n";
  });

  assert.equal(branch, "runx/evidence-projection-derive");
});

test("normalizePublishBranchName rejects direct publication to non-runx branches", () => {
  assert.throws(() => normalizePublishBranchName("main"), /runx\/\* automation branch/);
  assert.equal(
    normalizePublishBranchName("runx/generated-docs-pr"),
    "runx/generated-docs-pr",
  );
});
