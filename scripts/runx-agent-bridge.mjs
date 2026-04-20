import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  gateSelectorMatches,
  normalizeThreadTeachingContext,
  threadTeachingContextAllowsGate,
} from "./thread-teaching.mjs";

const execFileAsync = promisify(execFile);
export { gateSelectorMatches } from "./thread-teaching.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runxRepoRoot = resolveRunxRepoRoot(options.runxRoot);
  const cliBin = path.join(runxRepoRoot, "packages", "cli", "dist", "index.js");
  const receiptDir = path.resolve(options.receiptDir ?? ".artifacts/runx-bridge");
  const traceDir = path.resolve(options.traceDir ?? path.join(receiptDir, "provider-trace"));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aster-runx-bridge-"));
  const approvedGates = new Set([
    ...splitCsv(process.env.RUNX_APPROVED_GATES),
    ...options.approve,
  ]);
  const provider = options.provider ?? process.env.RUNX_CALLER_PROVIDER ?? "openai";
  const model = options.model ?? process.env.RUNX_CALLER_MODEL ?? "gpt-5.4";
  const reasoningEffort =
    options.reasoningEffort ?? process.env.RUNX_CALLER_REASONING_EFFORT ?? "xhigh";
  const maxTurns = Number(options.maxTurns ?? process.env.RUNX_CALLER_MAX_TURNS ?? "8");
  const contextText = await loadCallerContext(options.contextFile);
  const threadTeachingContext = await loadThreadTeachingContext(options.threadTeachingContextPath);
  const gateDecisionRecords = [];

  if (!existsSync(cliBin)) {
    throw new Error(`runx CLI build not found at ${cliBin}`);
  }
  if (options.runxArgs.length === 0) {
    throw new Error("No runx command was provided. Pass the runx invocation after --.");
  }

  await mkdir(receiptDir, { recursive: true });
  await mkdir(traceDir, { recursive: true });

  let runArgs = [...options.runxArgs];
  let latestExitCode = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const invocation = await runRunx({
      cliBin,
      receiptDir,
      runArgs,
      workdir: options.workdir,
    });

    latestExitCode = invocation.exitCode;

    if (!invocation.stdout.trim()) {
      throw new Error(invocation.stderr.trim() || "runx returned no JSON output.");
    }

    const report = JSON.parse(invocation.stdout);
    if (options.outputPath) {
      await writeFile(path.resolve(options.outputPath), JSON.stringify(report, null, 2));
    }

    if (report.status !== "needs_resolution") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(latestExitCode);
    }

    const answers = {};
    const approvals = {};

    for (const request of report.requests ?? []) {
      if (request.kind === "approval") {
        const gateId = String(request.gate?.id ?? "");
        const approvalMechanism = options.approveAll
          ? "approve_all"
          : setHasGateMatch(approvedGates, gateId)
            ? "explicit_gate_match"
            : threadTeachingContextAllowsGate(threadTeachingContext, request.gate)
              ? "thread_teaching_context"
              : null;
        if (approvalMechanism) {
          approvals[gateId] = true;
          gateDecisionRecords.push(buildGateDecisionRecord({
            gate: request.gate,
            threadTeachingContext,
            approvalMechanism,
          }));
          continue;
        }
        throw new Error(`Unapproved gate '${gateId}' encountered. Add --approve ${gateId} or set RUNX_APPROVED_GATES.`);
      }

      if (request.kind === "cognitive_work") {
        answers[request.id] = await resolveCognitiveWork({
          provider,
          model,
          reasoningEffort,
          contextText,
          request,
          traceDir,
        });
        continue;
      }

      throw new Error(`Unsupported runx resolution request kind: ${request.kind}`);
    }

    await writeGateDecisionRecords(options.gateDecisionsPath, gateDecisionRecords);
    const answersPath = path.join(tempDir, `answers-turn-${turn + 1}.json`);
    await writeFile(
      answersPath,
      `${JSON.stringify(compactAnswersPayload(answers, approvals), null, 2)}\n`,
    );
    runArgs = ["resume", String(report.run_id), "--answers", answersPath];
  }

  throw new Error(`runx bridge exceeded ${maxTurns} turns without reaching completion.`);
}

function parseArgs(argv) {
  const options = {
    approve: [],
    runxArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      options.runxArgs = argv.slice(index + 1);
      break;
    }
    if (token === "--runx-root") {
      options.runxRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--receipt-dir") {
      options.receiptDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--trace-dir") {
      options.traceDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workdir") {
      options.workdir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.outputPath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--context-file") {
      options.contextFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--thread-teaching-context") {
      options.threadTeachingContextPath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--gate-decisions") {
      options.gateDecisionsPath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--model") {
      options.model = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--provider") {
      options.provider = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-turns") {
      options.maxTurns = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--reasoning-effort") {
      options.reasoningEffort = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--approve") {
      options.approve.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--approve-all") {
      options.approveAll = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.runxRoot) {
    throw new Error("--runx-root is required.");
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

function resolveRunxRepoRoot(runxRoot) {
  const directRoot = path.resolve(runxRoot);
  if (existsSync(path.join(directRoot, "packages", "cli", "dist", "index.js"))) {
    return directRoot;
  }
  const nestedRoot = path.join(directRoot, "oss");
  if (existsSync(path.join(nestedRoot, "packages", "cli", "dist", "index.js"))) {
    return nestedRoot;
  }
  throw new Error(
    `Unable to resolve runx repo root from ${runxRoot}. Expected packages/cli/dist/index.js or oss/packages/cli/dist/index.js.`,
  );
}

async function runRunx({ cliBin, receiptDir, runArgs, workdir }) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        cliBin,
        ...runArgs,
        "--non-interactive",
        "--json",
        "--receipt-dir",
        receiptDir,
      ],
      {
        cwd: workdir ? path.resolve(workdir) : process.cwd(),
        env: process.env,
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    return {
      exitCode: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

async function resolveCognitiveWork({
  provider,
  model,
  reasoningEffort,
  contextText,
  request,
  traceDir,
}) {
  if (provider !== "openai") {
    throw new Error(`Unsupported provider '${provider}'.`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for runx cognitive work.");
  }

  const requestId = sanitizeTraceName(request.id);
  const expectedOutputs = request.work.envelope.expected_outputs ?? {};
  let previousFailure;
  let lastTransportError;
  const maxAttempts = Number(process.env.RUNX_CALLER_MAX_ATTEMPTS ?? "2");
  const requestTimeoutMs = Number(process.env.RUNX_CALLER_REQUEST_TIMEOUT_MS ?? "1200000");
  const maxToolCalls = Number(process.env.RUNX_CALLER_MAX_TOOL_CALLS ?? "4");

  attemptLoop:
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStartedAt = new Date().toISOString();
    const messages = buildInputMessages(request, expectedOutputs, previousFailure, contextText);

    for (let toolTurn = 1; toolTurn <= maxToolCalls + 1; toolTurn += 1) {
      const payload = buildResponsesPayload({ model, messages, reasoningEffort });

      let response;
      let requestPayload = payload;
      let requestApi = "responses";
      let initialFailure;
      try {
        response = await runProviderRequestWithTrace({
          requestId,
          attempt,
          maxAttempts,
          requestApi,
          traceDir,
          startedAt: attemptStartedAt,
          timeoutMs: requestTimeoutMs,
          expectedOutputs,
          requestPayload: payload,
          url: "https://api.openai.com/v1/responses",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Client-Request-Id": `${requestId}-${attempt}`.slice(0, 128),
          },
        });
      } catch (error) {
        lastTransportError = error;
        await writeAttemptTraceFile({
          traceDir,
          requestId,
          attempt,
          sequence: toolTurn,
          requestApi,
          request: payload,
          response: null,
          rawResponse: null,
          transportError: serializeError(error),
        });
        if (attempt < maxAttempts && isRetryableTransportError(error)) {
          await sleep(backoffDelayMs(attempt));
          continue attemptLoop;
        }
        throw error;
      }

      let raw = response.body;
      let parsed = safeJsonParse(raw);

      if (shouldFallbackToChatCompletions({ response, parsed })) {
        initialFailure = {
          api: requestApi,
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          raw,
        };
        requestApi = "chat_completions";
        requestPayload = buildChatCompletionsPayload({ model, messages });
        try {
          response = await runProviderRequestWithTrace({
            requestId,
            attempt,
            maxAttempts,
            requestApi,
            traceDir,
            startedAt: attemptStartedAt,
            timeoutMs: requestTimeoutMs,
            expectedOutputs,
            requestPayload,
            url: "https://api.openai.com/v1/chat/completions",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "X-Client-Request-Id": `${requestId}-${attempt}-fallback`.slice(0, 128),
            },
          });
        } catch (error) {
          lastTransportError = error;
          await writeAttemptTraceFile({
            traceDir,
            requestId,
            attempt,
            sequence: toolTurn,
            requestApi,
            request: requestPayload,
            response: null,
            rawResponse: null,
            initialFailure,
            transportError: serializeError(error),
          });
          if (attempt < maxAttempts && isRetryableTransportError(error)) {
            await sleep(backoffDelayMs(attempt));
            continue attemptLoop;
          }
          throw error;
        }
        raw = response.body;
        parsed = safeJsonParse(raw);
      }

      await writeAttemptTraceFile({
        traceDir,
        requestId,
        attempt,
        sequence: toolTurn,
        requestApi,
        request: requestPayload,
        response: parsed,
        rawResponse: raw,
        initialFailure,
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        await writeLiveTraceState({
          traceDir,
          requestId,
          snapshot: buildLiveTraceState({
            requestId,
            attempt,
            maxAttempts,
            requestApi,
            status: "http_error",
            timeoutMs: requestTimeoutMs,
            startedAt: attemptStartedAt,
            heartbeatAt: new Date().toISOString(),
            expectedOutputs,
            note: truncate(raw, 800),
            responseStatus: response.statusCode,
          }),
        });
        throw new Error(
          `OpenAI request failed: ${response.statusCode} ${response.statusMessage}\n${truncate(raw, 4000)}`,
        );
      }

      const toolRequests = extractAllowedToolRequests(parsed, request.work.envelope.allowed_tools);
      if (toolRequests.length > 0) {
        if (toolTurn > maxToolCalls) {
          previousFailure =
            `The response requested another tool call after exhausting ${maxToolCalls} allowed tool round(s). Return the final JSON object instead.`;
          break;
        }

        for (const toolRequest of toolRequests) {
          const toolResult = await executeAllowedToolRequest({
            toolRequest,
            request,
          });
          messages.push({
            role: "assistant",
            content: toolRequest.raw,
          });
          messages.push({
            role: "user",
            content: buildToolResultFollowupMessage(toolResult),
          });
        }

        await writeLiveTraceState({
          traceDir,
          requestId,
          snapshot: buildLiveTraceState({
            requestId,
            attempt,
            maxAttempts,
            requestApi,
            status: "tool_result",
            timeoutMs: requestTimeoutMs,
            startedAt: attemptStartedAt,
            heartbeatAt: new Date().toISOString(),
            expectedOutputs,
            note: `executed ${toolRequests.length} allowed tool request(s)`,
          }),
        });
        continue;
      }

      const outputTexts = extractOutputTextCandidates(parsed);
      if (outputTexts.length === 0) {
        previousFailure = `The response did not include output_text. Raw response: ${truncate(raw, 1200)}`;
        break;
      }

      let candidateFailure;
      for (const outputText of outputTexts) {
        const parsedOutput = safeJsonParse(outputText);
        if (!isPlainObject(parsedOutput)) {
          candidateFailure =
            `The response was not a JSON object. Raw output text: ${truncate(outputText, 1200)}`;
          continue;
        }

        const validationError = validateResolution(parsedOutput, expectedOutputs);
        if (!validationError) {
          await writeLiveTraceState({
            traceDir,
            requestId,
            snapshot: buildLiveTraceState({
              requestId,
              attempt,
              maxAttempts,
              requestApi,
              status: "completed",
              timeoutMs: requestTimeoutMs,
              startedAt: attemptStartedAt,
              heartbeatAt: new Date().toISOString(),
              expectedOutputs,
              note: "resolution accepted",
            }),
          });
          return parsedOutput;
        }

        candidateFailure = validationError;
      }

      previousFailure = candidateFailure;
      break;
    }

    const liveStatus = attempt < maxAttempts ? "retrying_invalid_response" : "failed";
    await writeLiveTraceState({
      traceDir,
      requestId,
      snapshot: buildLiveTraceState({
        requestId,
        attempt,
        maxAttempts,
        requestApi: "responses",
        status: liveStatus,
        timeoutMs: requestTimeoutMs,
        startedAt: attemptStartedAt,
        heartbeatAt: new Date().toISOString(),
        expectedOutputs,
        note: previousFailure,
      }),
    });
  }

  if (lastTransportError && !previousFailure) {
    throw lastTransportError;
  }

  throw new Error(
    `OpenAI response for ${request.id} did not satisfy the expected output contract after ${maxAttempts} attempts: ${previousFailure}`,
  );
}

function buildResponsesPayload({ model, messages, reasoningEffort }) {
  return {
    model,
    input: messages,
    reasoning: {
      effort: reasoningEffort,
    },
    text: {
      format: {
        type: "json_object",
      },
    },
  };
}

function buildChatCompletionsPayload({ model, messages }) {
  return {
    model,
    messages,
    response_format: {
      type: "json_object",
    },
  };
}

function postJson(url, { headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? "",
            body: raw,
          });
        });
        response.on("error", reject);
      },
    );

    request.setTimeout(timeoutMs, () => {
      const error = new Error(`OpenAI request timed out after ${timeoutMs}ms.`);
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

export function buildInputMessages(request, expectedOutputs, previousFailure, contextText) {
  const requiredKeys = Object.keys(expectedOutputs);
  const allowedTools = Array.isArray(request?.work?.envelope?.allowed_tools)
    ? request.work.envelope.allowed_tools.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const lines = [
    "You are the external caller for a governed runx skill boundary.",
    "Return exactly one JSON object.",
    "Do not wrap the JSON in markdown fences or prose.",
    "Ground every field in the provided inputs and context.",
    "Do not invent repository state, URLs, files, APIs, or evidence that are not present in the envelope.",
    "Keep outputs bounded and practical so the run can continue safely.",
  ];

  if (requiredKeys.length > 0) {
    lines.push(`Required top-level keys: ${requiredKeys.join(", ")}.`);
    lines.push(
      `Expected top-level types: ${requiredKeys
        .map((key) => `${key}=${expectedOutputs[key]}`)
        .join(", ")}.`,
    );
  }
  if (allowedTools.length > 0) {
    lines.push(
      `Allowed read-only tools for this request: ${allowedTools.join(", ")}.`,
    );
    lines.push(
      'If you need one of those tools before the final answer, return exactly one JSON object of the form {"tool":"<allowed tool>","args":{...}}.',
    );
    lines.push(
      "Do not combine a tool request with the final answer in the same JSON object.",
    );
  }

  const messages = [
    {
      role: "system",
      content: lines.join(" "),
    },
  ];

  if (contextText) {
    messages.push({
      role: "system",
      content: [
        "Use this operator context bundle as additional guidance for the task.",
        "Treat doctrine as constitutional guidance.",
        "Treat state, history, reflections, and artifact summaries as derived context that must yield to fresher evidence in the request envelope.",
        "",
        contextText,
      ].join("\n"),
    });
  }

  messages.push(
    {
      role: "user",
      content: JSON.stringify(
        {
          request_id: request.id,
          source_type: request.work.source_type,
          agent: request.work.agent,
          task: request.work.task,
          envelope: request.work.envelope,
        },
        null,
        2,
      ),
    },
  );

  if (previousFailure) {
    messages.push({
      role: "user",
      content: `The previous JSON output was invalid for this reason: ${previousFailure}\nReturn a corrected JSON object only.`,
    });
  }

  return messages;
}

function validateResolution(payload, expectedOutputs) {
  for (const [key, declaredType] of Object.entries(expectedOutputs)) {
    if (!(key in payload)) {
      return `Missing required top-level key '${key}'.`;
    }
    const actualValue = payload[key];
    if (!matchesDeclaredType(actualValue, String(declaredType))) {
      return `Top-level key '${key}' must be ${declaredType}, got ${describeValue(actualValue)}.`;
    }
  }
  return undefined;
}

function matchesDeclaredType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "json":
      return true;
    case "object":
    default:
      return isPlainObject(value);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describeValue(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return value;
  }
}

function truncate(value, maxLength) {
  if (typeof value !== "string" || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

export function extractOutputTextCandidates(response) {
  const ranked = [[], [], []];

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    ranked[0].push(response.output_text.trim());
  }

  const choices = Array.isArray(response.choices) ? response.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      ranked[0].push(content.trim());
    }
  }

  const outputItems = Array.isArray(response.output) ? response.output : [];
  for (const item of outputItems) {
    const content = Array.isArray(item?.content) ? item.content : [];
    const texts = content
      .map((block) => (typeof block?.text === "string" ? block.text.trim() : ""))
      .filter(Boolean);

    if (texts.length === 0) {
      continue;
    }

    if (item?.type === "message" && item?.role === "assistant" && item?.phase === "final_answer") {
      ranked[0].push(...texts);
      continue;
    }

    if (item?.type === "message" && item?.role === "assistant") {
      ranked[1].push(...texts);
      continue;
    }

    ranked[2].push(...texts);
  }

  const seen = new Set();
  const candidates = [];
  for (const group of ranked) {
    for (const text of group.reverse()) {
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);
      candidates.push(text);
    }
  }
  return candidates;
}

export function extractAssistantMessageBlocks(response) {
  const blocks = [];
  const outputItems = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputItems) {
    if (item?.type !== "message" || item?.role !== "assistant") {
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (typeof block?.text !== "string" || block.text.trim() === "") {
        continue;
      }
      blocks.push({
        phase: typeof item.phase === "string" ? item.phase : null,
        text: block.text.trim(),
      });
    }
  }

  if (blocks.length > 0) {
    return blocks;
  }

  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    blocks.push({
      phase: null,
      text: response.output_text.trim(),
    });
  }

  const choices = Array.isArray(response?.choices) ? response.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      blocks.push({
        phase: null,
        text: content.trim(),
      });
    }
  }

  return blocks;
}

export function parseToolRequestCandidate(text) {
  const parsed = safeJsonParse(text);
  if (!isPlainObject(parsed)) {
    return null;
  }
  const tool = typeof parsed.tool === "string" ? parsed.tool.trim() : "";
  if (!tool) {
    return null;
  }
  return {
    tool,
    args: isPlainObject(parsed.args) ? parsed.args : {},
    raw: text,
  };
}

export function extractAllowedToolRequests(response, allowedTools) {
  const allowed = new Set(
    (Array.isArray(allowedTools) ? allowedTools : [])
      .filter((value) => typeof value === "string" && value.trim().length > 0),
  );
  if (allowed.size === 0) {
    return [];
  }
  return extractAssistantMessageBlocks(response)
    .map((message) => {
      const parsed = parseToolRequestCandidate(message.text);
      if (!parsed || !allowed.has(parsed.tool)) {
        return null;
      }
      return {
        ...parsed,
        phase: message.phase,
      };
    })
    .filter(Boolean);
}

export async function executeAllowedToolRequest({ toolRequest, request }) {
  switch (toolRequest.tool) {
    case "fs.read":
      return await executeFsReadTool(toolRequest.args, request);
    case "git.status":
      return await executeGitStatusTool(toolRequest.args, request);
    default:
      return {
        tool: toolRequest.tool,
        ok: false,
        error: `Tool '${toolRequest.tool}' is not supported by this bridge.`,
      };
  }
}

async function executeFsReadTool(args, request) {
  const requestedPath = typeof args?.path === "string" && args.path.trim().length > 0
    ? args.path.trim()
    : null;
  if (!requestedPath) {
    return {
      tool: "fs.read",
      ok: false,
      error: "fs.read requires a non-empty string path.",
    };
  }

  const defaultRepoRoot = resolveDefaultToolRepoRoot(request);
  const repoRoot = typeof args?.repo_root === "string" && args.repo_root.trim().length > 0
    ? args.repo_root.trim()
    : defaultRepoRoot;
  const absolutePath = resolveToolPath(requestedPath, repoRoot);
  try {
    const contents = await readFile(absolutePath, "utf8");
    const maxChars = Number(process.env.RUNX_CALLER_MAX_FILE_CHARS ?? "200000");
    const truncated = contents.length > maxChars;
    return {
      tool: "fs.read",
      ok: true,
      data: {
        path: requestedPath,
        absolute_path: absolutePath,
        repo_root: repoRoot ?? null,
        contents: truncated ? `${contents.slice(0, maxChars)}\n...[truncated]` : contents,
        truncated,
      },
    };
  } catch (error) {
    return {
      tool: "fs.read",
      ok: false,
      error: error?.message ?? String(error),
      data: {
        path: requestedPath,
        absolute_path: absolutePath,
        repo_root: repoRoot ?? null,
      },
    };
  }
}

async function executeGitStatusTool(args, request) {
  const repoRoot = typeof args?.repo_root === "string" && args.repo_root.trim().length > 0
    ? args.repo_root.trim()
    : resolveDefaultToolRepoRoot(request) ?? process.cwd();
  try {
    const { stdout, stderr } = await execFileAsync("git", ["status", "--short", "--branch"], {
      cwd: path.resolve(repoRoot),
      env: process.env,
      maxBuffer: 5 * 1024 * 1024,
    });
    return {
      tool: "git.status",
      ok: true,
      data: {
        repo_root: path.resolve(repoRoot),
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exit_code: 0,
      },
    };
  } catch (error) {
    return {
      tool: "git.status",
      ok: false,
      error: error?.message ?? String(error),
      data: {
        repo_root: path.resolve(repoRoot),
        stdout: String(error?.stdout ?? "").trimEnd(),
        stderr: String(error?.stderr ?? "").trimEnd(),
        exit_code: Number.isInteger(error?.code) ? error.code : 1,
      },
    };
  }
}

function resolveDefaultToolRepoRoot(request) {
  const fixture = request?.work?.envelope?.inputs?.fixture;
  if (typeof fixture === "string" && fixture.trim().length > 0) {
    return fixture.trim();
  }
  return null;
}

function resolveToolPath(requestedPath, repoRoot) {
  if (path.isAbsolute(requestedPath)) {
    return path.resolve(requestedPath);
  }
  if (typeof repoRoot === "string" && repoRoot.trim().length > 0) {
    return path.resolve(repoRoot, requestedPath);
  }
  return path.resolve(requestedPath);
}

function buildToolResultFollowupMessage(toolResult) {
  return [
    "Allowed tool result for the previous request.",
    "Use this as fresh current context.",
    'If you still need another allowed tool call, return exactly one JSON object of the form {"tool":"<allowed tool>","args":{...}}.',
    "Otherwise return the final answer JSON object with the required top-level keys only.",
    "",
    JSON.stringify({ tool_result: toolResult }, null, 2),
  ].join("\n");
}

function compactAnswersPayload(answers, approvals) {
  const payload = {};
  if (Object.keys(answers).length > 0) {
    payload.answers = answers;
  }
  if (Object.keys(approvals).length > 0) {
    payload.approvals = approvals;
  }
  return payload;
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function loadCallerContext(contextFile) {
  const candidate = contextFile ?? process.env.RUNX_CALLER_CONTEXT_FILE;
  if (!candidate) {
    return "";
  }
  const resolved = path.resolve(candidate);
  const content = await readFile(resolved, "utf8");
  return content.trim();
}

async function loadThreadTeachingContext(threadTeachingContextPath) {
  if (!threadTeachingContextPath) {
    return null;
  }
  const resolved = path.resolve(threadTeachingContextPath);
  if (!existsSync(resolved)) {
    return null;
  }
  const parsed = JSON.parse(await readFile(resolved, "utf8"));
  return normalizeThreadTeachingContext(parsed);
}

export function threadTeachingAllowsGate(threadTeachingContext, gate) {
  return threadTeachingContextAllowsGate(threadTeachingContext, gate);
}

export function inferTraceHeartbeatIntervalMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 15000;
  }
  return Math.max(5000, Math.min(15000, Math.floor(timeoutMs / 6)));
}

export function buildLiveTraceState({
  requestId,
  attempt,
  maxAttempts,
  requestApi,
  status,
  timeoutMs,
  startedAt,
  heartbeatAt,
  expectedOutputs,
  note = null,
  responseStatus = null,
}) {
  const resolvedStartedAt = normalizeTimestamp(startedAt) ?? heartbeatAt ?? new Date().toISOString();
  const resolvedHeartbeatAt = normalizeTimestamp(heartbeatAt) ?? new Date().toISOString();
  const elapsedMs = Math.max(
    0,
    Date.parse(resolvedHeartbeatAt) - Date.parse(resolvedStartedAt),
  );
  return {
    kind: "aster.provider-trace-live.v1",
    request_id: requestId,
    attempt,
    max_attempts: maxAttempts,
    request_api: requestApi,
    status,
    timeout_ms: timeoutMs,
    expected_output_keys: Object.keys(expectedOutputs ?? {}),
    started_at: resolvedStartedAt,
    updated_at: resolvedHeartbeatAt,
    elapsed_ms: elapsedMs,
    response_status: responseStatus,
    note,
  };
}

function buildGateDecisionRecord({ gate, threadTeachingContext, approvalMechanism }) {
  const matchingAuthorization = (threadTeachingContext?.gate_authorizations ?? []).find((authorization) =>
    gateSelectorMatches(normalizeString(authorization?.selector), normalizeString(gate?.id))
  );
  const sourceRecord = (threadTeachingContext?.records ?? []).find((record) =>
    normalizeString(record?.record_id) === normalizeString(matchingAuthorization?.record_id)
  );
  return {
    gate_id: normalizeString(gate?.id) || "unknown-gate",
    gate_reason: normalizeString(gate?.reason),
    gate_type: normalizeString(gate?.type),
    resolved_at: new Date().toISOString(),
    decision: "approved",
    approval_mechanism: approvalMechanism ?? "explicit_gate_match",
    authorization_selector: matchingAuthorization?.selector ?? null,
    authorization_reason: matchingAuthorization?.reason ?? sourceRecord?.summary ?? null,
    teaching_record_id: matchingAuthorization?.record_id ?? sourceRecord?.record_id ?? null,
    teaching_kind: sourceRecord?.kind ?? matchingAuthorization?.kind ?? null,
    source_type: sourceRecord?.source_type ?? matchingAuthorization?.source_type ?? null,
    source_url: sourceRecord?.source_url ?? matchingAuthorization?.source_url ?? null,
    recorded_by: sourceRecord?.recorded_by ?? matchingAuthorization?.recorded_by ?? null,
    target_repo: sourceRecord?.target_repo ?? null,
    subject_locator: sourceRecord?.subject_locator ?? null,
    objective_fingerprint: sourceRecord?.objective_fingerprint ?? null,
    applies_to: sourceRecord?.applies_to ?? [],
    labels: sourceRecord?.labels ?? [],
    invariants: sourceRecord?.invariants ?? [],
    notes: sourceRecord?.notes ?? [],
  };
}

async function writeGateDecisionRecords(gateDecisionsPath, gateDecisionRecords) {
  if (!gateDecisionsPath || gateDecisionRecords.length === 0) {
    return;
  }
  const resolved = path.resolve(gateDecisionsPath);
  const deduped = dedupeGateDecisionRecords(gateDecisionRecords);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(deduped, null, 2)}\n`);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function dedupeGateDecisionRecords(records) {
  const seen = new Set();
  const deduped = [];
  for (const record of Array.isArray(records) ? records : []) {
    const gateId = normalizeString(record?.gate_id) || "unknown-gate";
    if (seen.has(gateId)) {
      continue;
    }
    seen.add(gateId);
    deduped.push(record);
  }
  return deduped;
}

function setHasGateMatch(values, gateId) {
  for (const value of values) {
    if (gateSelectorMatches(value, gateId)) {
      return true;
    }
  }
  return false;
}

function sanitizeTraceName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

async function writeAttemptTraceFile({
  traceDir,
  requestId,
  attempt,
  sequence = 1,
  requestApi,
  request,
  response,
  rawResponse,
  initialFailure = null,
  transportError = null,
}) {
  const fileName = sequence > 1
    ? `${requestId}-attempt-${attempt}-step-${sequence}.json`
    : `${requestId}-attempt-${attempt}.json`;
  await writeFile(
    path.join(traceDir, fileName),
    `${JSON.stringify(
      {
        request_api: requestApi,
        sequence,
        request,
        response,
        raw_response: rawResponse,
        initial_failure: initialFailure,
        transport_error: transportError,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeLiveTraceState({ traceDir, requestId, snapshot }) {
  const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(path.join(traceDir, `${requestId}-live.json`), rendered);
  await writeFile(path.join(traceDir, "latest.json"), rendered);
}

function logBridgeProgress({ requestId, attempt, maxAttempts, requestApi, status, note, elapsedMs }) {
  const suffix = typeof note === "string" && note.trim().length > 0 ? ` ${note.trim()}` : "";
  const elapsed = Number.isFinite(elapsedMs) ? ` elapsed_ms=${elapsedMs}` : "";
  process.stderr.write(
    `[runx-agent-bridge] request=${requestId} attempt=${attempt}/${maxAttempts} api=${requestApi} status=${status}${elapsed}${suffix}\n`,
  );
}

async function runProviderRequestWithTrace({
  requestId,
  attempt,
  maxAttempts,
  requestApi,
  traceDir,
  startedAt,
  timeoutMs,
  expectedOutputs,
  requestPayload,
  url,
  headers,
}) {
  const resolvedStartedAt = normalizeTimestamp(startedAt) ?? new Date().toISOString();
  const heartbeatIntervalMs = inferTraceHeartbeatIntervalMs(timeoutMs);
  const emit = async ({ status, note = null, responseStatus = null, heartbeatAt } = {}) => {
    const snapshot = buildLiveTraceState({
      requestId,
      attempt,
      maxAttempts,
      requestApi,
      status,
      timeoutMs,
      startedAt: resolvedStartedAt,
      heartbeatAt,
      expectedOutputs,
      note,
      responseStatus,
    });
    await writeLiveTraceState({ traceDir, requestId, snapshot });
    return snapshot;
  };

  const startedSnapshot = await emit({
    status: "requesting",
    note: `timeout_ms=${timeoutMs}`,
  });
  logBridgeProgress({
    requestId,
    attempt,
    maxAttempts,
    requestApi,
    status: startedSnapshot.status,
    note: startedSnapshot.note,
    elapsedMs: startedSnapshot.elapsed_ms,
  });

  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date().toISOString();
    const note = `still waiting; heartbeat_interval_ms=${heartbeatIntervalMs}`;
    void emit({
      status: "waiting",
      note,
      heartbeatAt,
    }).then((snapshot) => {
      logBridgeProgress({
        requestId,
        attempt,
        maxAttempts,
        requestApi,
        status: snapshot.status,
        note,
        elapsedMs: snapshot.elapsed_ms,
      });
    }).catch(() => {});
  }, heartbeatIntervalMs);

  try {
    const response = await postJson(url, {
      headers,
      body: JSON.stringify(requestPayload),
      timeoutMs,
    });
    clearInterval(heartbeat);
    const receivedSnapshot = await emit({
      status: response.statusCode >= 200 && response.statusCode < 300 ? "received" : "http_error",
      responseStatus: response.statusCode,
      note: response.statusMessage || null,
    });
    logBridgeProgress({
      requestId,
      attempt,
      maxAttempts,
      requestApi,
      status: receivedSnapshot.status,
      note: receivedSnapshot.note,
      elapsedMs: receivedSnapshot.elapsed_ms,
    });
    return response;
  } catch (error) {
    clearInterval(heartbeat);
    const failedSnapshot = await emit({
      status: "transport_error",
      note: error?.message ?? String(error),
    });
    logBridgeProgress({
      requestId,
      attempt,
      maxAttempts,
      requestApi,
      status: failedSnapshot.status,
      note: failedSnapshot.note,
      elapsedMs: failedSnapshot.elapsed_ms,
    });
    throw error;
  }
}

export function shouldFallbackToChatCompletions({ response, parsed }) {
  if (process.env.RUNX_DISABLE_CHAT_COMPLETIONS_FALLBACK === "true") {
    return false;
  }

  if (response?.statusCode !== 401) {
    return false;
  }

  const message = String(parsed?.error?.message ?? "");
  return /api\.responses\.write|insufficient permissions/i.test(message);
}

function isRetryableTransportError(error) {
  const code = String(error?.cause?.code ?? error?.code ?? "");
  return [
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
  ].includes(code);
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    cause: error?.cause
      ? {
          name: error.cause.name ?? "Error",
          message: error.cause.message ?? String(error.cause),
          code: error.cause.code ?? null,
        }
      : null,
  };
}

function backoffDelayMs(attempt) {
  return 1000 * attempt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
