import test from "node:test";
import assert from "node:assert/strict";

import { buildCheckoutArgs, buildPushArgs, ensureRemoteLease } from "./publish-runx-pr.mjs";

test("ensureRemoteLease fetches the remote automation branch before pushing", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "ls-remote") {
      return "abc123\trefs/heads/runx/operator-memory-pr-triage-pr-8\n";
    }
    if (args[0] === "fetch") {
      return "";
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };

  const lease = ensureRemoteLease("runx/operator-memory-pr-triage-pr-8", runner);

  assert.equal(lease, "abc123");
  assert.deepEqual(calls, [
    ["git", ["ls-remote", "--heads", "origin", "runx/operator-memory-pr-triage-pr-8"]],
    [
      "git",
      [
        "fetch",
        "--no-tags",
        "origin",
        "runx/operator-memory-pr-triage-pr-8:refs/remotes/origin/runx/operator-memory-pr-triage-pr-8",
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

  const lease = ensureRemoteLease("runx/sourcey-refresh", runner);

  assert.equal(lease, null);
  assert.deepEqual(calls, [["git", ["ls-remote", "--heads", "origin", "runx/sourcey-refresh"]]]);
});

test("buildCheckoutArgs reuses the remote branch tip without rewriting origin", () => {
  assert.deepEqual(buildCheckoutArgs("runx/sourcey-refresh", "abc123"), [
    "checkout",
    "-B",
    "runx/sourcey-refresh",
    "refs/remotes/origin/runx/sourcey-refresh",
  ]);
});

test("buildCheckoutArgs creates a fresh branch when no remote tip exists", () => {
  assert.deepEqual(buildCheckoutArgs("runx/sourcey-refresh", null), [
    "checkout",
    "-B",
    "runx/sourcey-refresh",
  ]);
});

test("buildPushArgs uses a non-destructive fast-forward push when a remote tip is known", () => {
  assert.deepEqual(buildPushArgs("runx/sourcey-refresh", "abc123"), [
    "push",
    "-u",
    "origin",
    "runx/sourcey-refresh",
  ]);
});

test("buildPushArgs uses the same non-destructive push shape for new branches", () => {
  assert.deepEqual(buildPushArgs("runx/sourcey-refresh", null), [
    "push",
    "-u",
    "origin",
    "runx/sourcey-refresh",
  ]);
});
