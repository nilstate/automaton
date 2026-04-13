import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTaskId } from "./run-issue-supervisor-workers.mjs";

test("normalizeTaskId converts mixed separators into kebab-case", () => {
  assert.equal(normalizeTaskId("GitHub_Issue-5"), "github-issue-5");
});

test("normalizeTaskId falls back when the candidate has no usable characters", () => {
  assert.equal(normalizeTaskId("___"), "issue-task");
});

test("normalizeTaskId preserves existing kebab ids", () => {
  assert.equal(normalizeTaskId("issue-5-worker-01"), "issue-5-worker-01");
});
