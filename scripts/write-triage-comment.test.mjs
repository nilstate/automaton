import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./write-triage-comment.mjs", import.meta.url));

test("write-triage-comment materializes a public comment body", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aster-triage-comment-"));
  try {
    const input = path.join(dir, "result.json");
    const output = path.join(dir, "comment.md");
    await writeFile(input, JSON.stringify({
      execution: {
        stdout: JSON.stringify({
          response_draft: {
            body: "Post this concrete maintainer comment.",
          },
        }),
      },
    }));

    execFileSync("node", [scriptPath, "--input", input, "--output", output], { encoding: "utf8" });

    assert.equal(await readFile(output, "utf8"), "Post this concrete maintainer comment.\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write-triage-comment treats internal no-op as a successful skip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aster-triage-comment-"));
  try {
    const input = path.join(dir, "result.json");
    const output = path.join(dir, "comment.md");
    await writeFile(input, JSON.stringify({
      execution: {
        stdout: JSON.stringify({
          response_strategy: {
            should_post_public_comment: false,
            next_best_action: "Wait for reviewer activity.",
          },
          response_draft: {
            mode: "internal_no_op",
            public_comment: null,
            internal_handoff: "No public PR comment recommended.",
          },
        }),
      },
    }));

    const stdout = execFileSync("node", [scriptPath, "--input", input, "--output", output], { encoding: "utf8" });

    assert.equal(stdout, "No public triage comment recommended.\n");
    assert.equal(existsSync(output), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "comment.decision.json"), "utf8")), {
      status: "no_public_comment",
      mode: "internal_no_op",
      reason: "Wait for reviewer activity.",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write-triage-comment treats should_post false as a successful skip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aster-triage-comment-"));
  try {
    const input = path.join(dir, "result.json");
    const output = path.join(dir, "comment.md");
    await writeFile(input, JSON.stringify({
      execution: {
        stdout: JSON.stringify({
          response_strategy: {
            recommended_action: "no_public_comment",
            next_best_step: "Inspect receipts before promotion.",
          },
          response_draft: {
            should_post: false,
            public_comment: "",
            internal_handoff: "No maintainer comment recommended right now.",
          },
        }),
      },
    }));

    const stdout = execFileSync("node", [scriptPath, "--input", input, "--output", output], { encoding: "utf8" });

    assert.equal(stdout, "No public triage comment recommended.\n");
    assert.equal(existsSync(output), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "comment.decision.json"), "utf8")), {
      status: "no_public_comment",
      mode: null,
      reason: "Inspect receipts before promotion.",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
