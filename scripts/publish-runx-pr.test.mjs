import test from "node:test";
import assert from "node:assert/strict";

import { buildPushArgs, ensureRemoteLease } from "./publish-runx-pr.mjs";

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

test("buildPushArgs uses an explicit lease when a remote tip is known", () => {
  assert.deepEqual(buildPushArgs("runx/sourcey-refresh", "abc123"), [
    "push",
    "-u",
    "origin",
    "runx/sourcey-refresh",
    "--force-with-lease=refs/heads/runx/sourcey-refresh:abc123",
  ]);
});

test("buildPushArgs falls back to plain force-with-lease for new branches", () => {
  assert.deepEqual(buildPushArgs("runx/sourcey-refresh", null), [
    "push",
    "-u",
    "origin",
    "runx/sourcey-refresh",
    "--force-with-lease",
  ]);
});
