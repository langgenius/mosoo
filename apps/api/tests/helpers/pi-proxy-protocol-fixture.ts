import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PresetModelProtocol } from "@mosoo/contracts/models";

import { readPiModelConfiguration } from "../../../driver/src/runtimes/pi/pi-configuration";
import { PI_MODEL_CONFIGURATION_SOURCE } from "../../../driver/src/runtimes/pi/pi-model-configuration";

const piCli = fileURLToPath(
  new URL(
    "../../../driver/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    import.meta.url,
  ),
);
export const PI_PROXY_TOOL_PROOF = "pi-proxy-tool-proof";
export const PI_PROXY_FINAL_TEXT = "Pi protocol round trip completed.";
const toolArguments = {
  command: `printf '${PI_PROXY_TOOL_PROOF}'`,
  description: "Print the protocol integration proof",
};

function sse(records: readonly Record<string, unknown>[]): Response {
  return new Response(
    records
      .map(
        (record) =>
          `${typeof record["type"] === "string" ? `event: ${record["type"]}\n` : ""}data: ${JSON.stringify(record)}\n\n`,
      )
      .join(""),
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

export function piProxyProtocolResponse(protocol: PresetModelProtocol, tool: boolean): Response {
  switch (protocol) {
    case "openai-chat-completions": {
      const delta = tool
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_proxy",
                type: "function",
                function: { name: "bash", arguments: JSON.stringify(toolArguments) },
              },
            ],
          }
        : { role: "assistant", content: PI_PROXY_FINAL_TEXT };
      const chunk = (value: object, finish: string | null) => ({
        id: "chat_proxy",
        object: "chat.completion.chunk",
        model: "pi-test",
        choices: [{ index: 0, delta: value, finish_reason: finish }],
      });
      return sse([chunk(delta, null), chunk({}, tool ? "tool_calls" : "stop")]);
    }
    case "anthropic-messages":
      return sse([
        {
          type: "message_start",
          message: {
            id: "msg_proxy",
            type: "message",
            role: "assistant",
            model: "pi-test",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: tool
            ? { type: "tool_use", id: "tool_proxy", name: "bash", input: {} }
            : { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: tool
            ? { type: "input_json_delta", partial_json: JSON.stringify(toolArguments) }
            : { type: "text_delta", text: PI_PROXY_FINAL_TEXT },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
          usage: { output_tokens: 10 },
        },
        { type: "message_stop" },
      ]);
    case "openai-responses": {
      const item = tool
        ? {
            type: "function_call",
            id: "fc_proxy",
            call_id: "call_proxy",
            name: "bash",
            arguments: JSON.stringify(toolArguments),
            status: "completed",
          }
        : {
            type: "message",
            id: "msg_proxy",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: PI_PROXY_FINAL_TEXT, annotations: [] }],
          };
      return sse([
        {
          type: "response.created",
          response: { id: "resp_proxy", status: "in_progress", output: [] },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: tool
            ? { ...item, arguments: "", status: "in_progress" }
            : { ...item, content: [], status: "in_progress" },
        },
        ...(tool
          ? [
              {
                type: "response.function_call_arguments.delta",
                item_id: "fc_proxy",
                output_index: 0,
                delta: JSON.stringify(toolArguments),
              },
            ]
          : [
              {
                type: "response.content_part.added",
                output_index: 0,
                content_index: 0,
                item_id: "msg_proxy",
                part: { type: "output_text", text: "", annotations: [] },
              },
              {
                type: "response.output_text.delta",
                output_index: 0,
                content_index: 0,
                item_id: "msg_proxy",
                delta: PI_PROXY_FINAL_TEXT,
              },
            ]),
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: "resp_proxy",
            status: "completed",
            output: [item],
            usage: {
              input_tokens: 10,
              output_tokens: 10,
              total_tokens: 20,
              input_tokens_details: { cached_tokens: 0 },
            },
          },
        },
      ]);
    }
    case "google-gemini":
      return sse([
        {
          candidates: [
            {
              index: 0,
              content: {
                role: "model",
                parts: tool
                  ? [{ functionCall: { name: "bash", args: toolArguments } }]
                  : [{ text: PI_PROXY_FINAL_TEXT }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          modelVersion: "pi-test",
        },
      ]);
  }
}

interface PiProxyModel {
  provider: string;
  model: string;
  thinkingLevel?: string;
}

/** Real pinned Pi CLI, with all model traffic directed at the test's Host proxy. */
export async function runPiProxyTurn(
  variables: Record<string, string>,
  input: PiProxyModel,
): Promise<Record<string, unknown>[]> {
  const configuration = readPiModelConfiguration({
    provider: input.provider,
    model: input.model,
    providerOptions:
      input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel },
    environment: { variables },
  });
  const { provider, model, thinkingLevel } = configuration;
  const home = await mkdtemp(join(tmpdir(), "mosoo-pi-proxy-"));
  const agentDir = join(home, "pi");
  await mkdir(agentDir);
  await writeFile(join(agentDir, "models.json"), "{}", { mode: 0o600 });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      retry: { enabled: false },
      packages: [],
      extensions: [],
      skills: [],
      promptTemplates: [],
    }),
  );
  const extension = join(agentDir, "mosoo-model.mjs");
  await writeFile(
    extension,
    `${PI_MODEL_CONFIGURATION_SOURCE}\nexport default function(pi) { configurePiModel(pi, ${JSON.stringify(configuration)}); }`,
  );
  const child = spawn(
    "node",
    [
      piCli,
      "--mode",
      "rpc",
      "--provider",
      provider,
      "--model",
      model,
      "--extension",
      extension,
      ...(thinkingLevel === undefined ? [] : ["--thinking", thinkingLevel]),
      "--offline",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-approve",
    ],
    {
      cwd: home,
      env: {
        PATH: process.env["PATH"] ?? "",
        ...variables,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const events: Record<string, unknown>[] = [];
  const finished = Promise.withResolvers<Record<string, unknown>[]>();
  const exited = Promise.withResolvers<void>();
  let stderr = "";
  let pending = "";
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
  });
  child.on("error", (error) => finished.reject(error));
  child.on("close", (code) => {
    exited.resolve();
    finished.reject(new Error(`Pi exited before agent_end (${code}): ${stderr}`));
  });
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    while (pending.includes("\n")) {
      const boundary = pending.indexOf("\n");
      const line = pending.slice(0, boundary);
      pending = pending.slice(boundary + 1);
      if (!line.trim()) continue;
      try {
        const record: unknown = JSON.parse(line);
        if (typeof record !== "object" || record === null || Array.isArray(record))
          throw new Error("Pi emitted an invalid RPC record.");
        const event = record as Record<string, unknown>;
        events.push(event);
        if (event["type"] === "response" && event["success"] === false)
          finished.reject(new Error(JSON.stringify(event)));
        if (event["type"] === "agent_end") finished.resolve(events);
      } catch (error) {
        finished.reject(error);
      }
    }
  });
  const timeout = setTimeout(
    () => finished.reject(new Error(`Pi RPC timed out: ${stderr}`)),
    25_000,
  );
  try {
    child.stdin.write(`${JSON.stringify({ id: "test-state", type: "get_state" })}\n`);
    child.stdin.write(
      `${JSON.stringify({ id: "test-prompt", type: "prompt", message: "Run the provided bash tool and then finish." })}\n`,
    );
    return await finished.promise;
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await exited.promise;
    clearTimeout(killTimer);
    await rm(home, { recursive: true, force: true });
  }
}

/** Real pinned OpenCode CLI using Host-rendered provider configuration. */
export async function runOpenCodeProxyTurn(
  variables: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const home = await mkdtemp(join(tmpdir(), "mosoo-opencode-proxy-"));
  const executable = fileURLToPath(
    new URL("../../../driver/node_modules/.bin/opencode", import.meta.url),
  );
  const child = spawn(
    executable,
    [
      "run",
      "--pure",
      "--auto",
      "--format",
      "json",
      "--model",
      "openai-compatible/pi-test",
      "--title",
      "Protocol integration fixture",
      "Run the provided bash tool and then finish.",
    ],
    {
      cwd: home,
      env: {
        PATH: process.env["PATH"] ?? "",
        ...variables,
        HOME: home,
        OPENCODE_TEST_HOME: home,
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_STATE_HOME: join(home, ".local", "state"),
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_SHARE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  const finished = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
  });
  child.on("error", (error) => finished.reject(error));
  child.on("close", (code) => {
    closed.resolve();
    if (code === 0) finished.resolve();
    else finished.reject(new Error(`OpenCode exited (${code}): ${stderr}\n${stdout}`));
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    finished.reject(new Error(`OpenCode timed out: ${stderr}\n${stdout}`));
  }, 25_000);
  try {
    await finished.promise;
    return stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const event: unknown = JSON.parse(line);
        if (typeof event !== "object" || event === null || Array.isArray(event))
          throw new Error("OpenCode emitted invalid JSON.");
        return event as Record<string, unknown>;
      });
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGKILL");
    await closed.promise;
    await rm(home, { recursive: true, force: true });
  }
}
