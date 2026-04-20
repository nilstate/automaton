import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  buildLiveTraceState,
  buildInputMessages,
  executeAllowedToolRequest,
  extractAllowedToolRequests,
  extractAssistantMessageBlocks,
  gateSelectorMatches,
  inferTraceHeartbeatIntervalMs,
  parseToolRequestCandidate,
  threadTeachingAllowsGate,
} from "./runx-agent-bridge.mjs";

test("gateSelectorMatches supports exact and wildcard gate selectors", () => {
  assert.equal(gateSelectorMatches("issue-triage.plan", "issue-triage.plan"), true);
  assert.equal(gateSelectorMatches("issue-triage.*", "issue-triage.plan"), true);
  assert.equal(gateSelectorMatches("issue-triage.*", "fix-pr.review"), false);
});

test("threadTeachingAllowsGate auto-approves only explicitly scoped gates", () => {
  const threadTeachingContext = {
    records: [
      {
        record_id: "record-1",
        kind: "approval",
        summary: "Planning and build are approved.",
        applies_to: ["issue-triage.plan", "fix-pr.review"],
        decisions: [
          {
            gate_id: "issue-triage.build",
            decision: "allow",
            reason: "build is explicitly approved",
          },
        ],
      },
    ],
  };

  assert.equal(threadTeachingAllowsGate(threadTeachingContext, { id: "issue-triage.plan" }), true);
  assert.equal(threadTeachingAllowsGate(threadTeachingContext, { id: "issue-triage.build" }), true);
  assert.equal(threadTeachingAllowsGate(threadTeachingContext, { id: "docs-pr.publish" }), false);
});

test("inferTraceHeartbeatIntervalMs stays bounded for hosted requests", () => {
  assert.equal(inferTraceHeartbeatIntervalMs(300000), 15000);
  assert.equal(inferTraceHeartbeatIntervalMs(12000), 5000);
  assert.equal(inferTraceHeartbeatIntervalMs(Number.NaN), 15000);
});

test("buildLiveTraceState renders a stable live trace snapshot", () => {
  const snapshot = buildLiveTraceState({
    requestId: "resolve-comment",
    attempt: 2,
    maxAttempts: 3,
    requestApi: "responses",
    status: "waiting",
    timeoutMs: 300000,
    startedAt: "2026-04-20T06:00:00.000Z",
    heartbeatAt: "2026-04-20T06:00:15.000Z",
    expectedOutputs: {
      comment_body: "string",
      should_post: "boolean",
    },
    note: "still waiting",
    responseStatus: null,
  });

  assert.equal(snapshot.kind, "aster.provider-trace-live.v1");
  assert.equal(snapshot.request_id, "resolve-comment");
  assert.equal(snapshot.attempt, 2);
  assert.equal(snapshot.max_attempts, 3);
  assert.equal(snapshot.request_api, "responses");
  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.timeout_ms, 300000);
  assert.equal(snapshot.elapsed_ms, 15000);
  assert.deepEqual(snapshot.expected_output_keys, ["comment_body", "should_post"]);
  assert.equal(snapshot.note, "still waiting");
});

test("buildInputMessages advertises the allowed tool request contract", () => {
  const messages = buildInputMessages({
    work: {
      envelope: {
        allowed_tools: ["fs.read", "git.status"],
      },
    },
  }, { fix_bundle: "object" }, undefined, "");

  assert.match(messages[0].content, /Allowed read-only tools for this request: fs\.read, git\.status\./);
  assert.match(messages[0].content, /If you need one of those tools before the final answer/);
});

test("extractAssistantMessageBlocks preserves assistant message order from responses output", () => {
  const blocks = extractAssistantMessageBlocks({
    output: [
      {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [
          {
            type: "output_text",
            text: "{\"tool\":\"git.status\",\"args\":{\"repo_root\":\"/tmp/repo\"}}",
          },
        ],
      },
      {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [
          {
            type: "output_text",
            text: "{\"fix_bundle\":{\"files\":[]}}",
          },
        ],
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      phase: "commentary",
      text: "{\"tool\":\"git.status\",\"args\":{\"repo_root\":\"/tmp/repo\"}}",
    },
    {
      phase: "final_answer",
      text: "{\"fix_bundle\":{\"files\":[]}}",
    },
  ]);
});

test("parseToolRequestCandidate accepts strict tool request JSON only", () => {
  assert.deepEqual(
    parseToolRequestCandidate("{\"tool\":\"fs.read\",\"args\":{\"path\":\"docs/flows.md\"}}"),
    {
      tool: "fs.read",
      args: {
        path: "docs/flows.md",
      },
      raw: "{\"tool\":\"fs.read\",\"args\":{\"path\":\"docs/flows.md\"}}",
    },
  );
  assert.equal(parseToolRequestCandidate("{\"fix_bundle\":{\"files\":[]}}"), null);
  assert.equal(parseToolRequestCandidate("not-json"), null);
});

test("extractAllowedToolRequests prefers allowed commentary tool requests over a later final answer", () => {
  const requests = extractAllowedToolRequests({
    output: [
      {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [
          {
            type: "output_text",
            text: "{\"tool\":\"git.status\",\"args\":{\"repo_root\":\"/tmp/repo\"}}",
          },
          {
            type: "output_text",
            text: "{\"tool\":\"fs.read\",\"args\":{\"path\":\"docs/flows.md\",\"repo_root\":\"/tmp/repo\"}}",
          },
        ],
      },
      {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [
          {
            type: "output_text",
            text: "{\"fix_bundle\":{\"status\":\"blocked\",\"files\":[]}}",
          },
        ],
      },
    ],
  }, ["git.status", "fs.read"]);

  assert.deepEqual(requests, [
    {
      tool: "git.status",
      args: {
        repo_root: "/tmp/repo",
      },
      raw: "{\"tool\":\"git.status\",\"args\":{\"repo_root\":\"/tmp/repo\"}}",
      phase: "commentary",
    },
    {
      tool: "fs.read",
      args: {
        path: "docs/flows.md",
        repo_root: "/tmp/repo",
      },
      raw: "{\"tool\":\"fs.read\",\"args\":{\"path\":\"docs/flows.md\",\"repo_root\":\"/tmp/repo\"}}",
      phase: "commentary",
    },
  ]);
});

test("extractAllowedToolRequests ignores tools outside the allowed set", () => {
  const requests = extractAllowedToolRequests({
    output_text: "{\"tool\":\"fs.read\",\"args\":{\"path\":\"docs/flows.md\"}}",
  }, ["git.status"]);

  assert.deepEqual(requests, []);
});

test("bridge helper tools can read files and git status from a fixture repo", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "runx-agent-bridge-"));
  try {
    await writeFile(path.join(fixture, "note.txt"), "hello bridge\n");
    execFileSync("git", ["init", "-b", "main"], { cwd: fixture, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "smoke@example.com"], { cwd: fixture, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Smoke Test"], { cwd: fixture, stdio: "ignore" });
    execFileSync("git", ["add", "note.txt"], { cwd: fixture, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: fixture, stdio: "ignore" });

    const fileResult = await executeAllowedToolRequest({
      toolRequest: {
        tool: "fs.read",
        args: {
          path: "note.txt",
          repo_root: fixture,
        },
        raw: "{\"tool\":\"fs.read\"}",
      },
      request: {
        work: {
          envelope: {
            inputs: {
              fixture,
            },
          },
        },
      },
    });
    assert.equal(fileResult.tool, "fs.read");
    assert.equal(fileResult.ok, true);
    assert.equal(fileResult.data.contents, "hello bridge\n");

    const statusResult = await executeAllowedToolRequest({
      toolRequest: {
        tool: "git.status",
        args: {
          repo_root: fixture,
        },
        raw: "{\"tool\":\"git.status\"}",
      },
      request: {
        work: {
          envelope: {
            inputs: {
              fixture,
            },
          },
        },
      },
    });
    assert.equal(statusResult.tool, "git.status");
    assert.equal(statusResult.ok, true);
    assert.match(statusResult.data.stdout, /## main/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
