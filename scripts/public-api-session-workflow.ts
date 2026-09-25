import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  PublicFileResponse,
  PublicThreadConfiguration,
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiListThreadEventsResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadFileListResponse,
  PublicThreadUsageResponse,
} from "@mosoo/contracts/public-api";

import { loadRepoEnv } from "../e2e/env";
import { parsePlatformId } from "../pkgs/id/src/index";
import { assertNonProductionBaseUrl } from "./public-api-nonproduction-smoke";

// Reuse these requests for CLI/client contract acceptance. All operations use thread.id.
export const SESSION_WORKFLOW_INPUT = {
  input: {
    type: "user.message",
    content: [
      {
        type: "text",
        text: "Use real Python tools to read the attached input.csv and copy it into the working directory for analysis. Generate a random private nonce in .private/nonce outside outputs. Write outputs/initial.json with grand_total and private_nonce_sha256 (hash the raw file bytes). Save outputs/report.md and outputs/chart.svg. Keep input.csv and the nonce for our next turn. Do not return success if any tool fails.",
      },
    ],
  },
};
export const SESSION_WORKFLOW_FOLLOWUP = {
  events: [
    {
      type: "user_message",
      text: "Continue using our original input.csv and private nonce. Do not recreate them. Append south,20 to the CSV using a real tool, regenerate report.md and chart.svg, and write outputs/followup.json containing grand_total and private_nonce_sha256 using the original raw file bytes. Fail explicitly if our prior files are unavailable.",
    },
  ],
};
const CANCEL_WORK_INPUT = {
  events: [
    {
      type: "user_message",
      text: "Use a tool to sleep for 90 seconds, then say done. Do not change any files. This turn is a cancellation test.",
    },
  ],
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function runSessionWorkflow(input: {
  projectId: string;
  configuration: PublicThreadConfiguration;
  baseUrl: URL;
  idempotencyPrefix: string;
  outputDirectory: string;
  token: string;
}): Promise<void> {
  const base = assertNonProductionBaseUrl(input.baseUrl.href, "v2").href.replace(/\/$/, "");
  const projectId = parsePlatformId(input.projectId, "Project ID");
  const headers = { Authorization: `Bearer ${input.token}` };
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(45_000),
    });
    if (!response.ok)
      throw new Error(`${init.method ?? "GET"} ${path} returned HTTP ${response.status}.`);
    return response;
  };
  const post = (path: string, body: unknown, step: string) =>
    call(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${input.idempotencyPrefix}-${step}`,
      },
    });
  const upload = new FormData();
  upload.set(
    "file",
    new File(["region,revenue\nnorth,120\nsouth,80\nnorth,30\n"], "input.csv", {
      type: "text/csv",
    }),
  );
  const uploaded: PublicFileResponse = await (
    await call(`/projects/${projectId}/files`, { method: "POST", body: upload })
  ).json();
  const createBody = {
    ...SESSION_WORKFLOW_INPUT,
    configuration: input.configuration,
    resources: [{ type: "file", file_id: uploaded.file.id }],
  };
  const createPath = `/projects/${projectId}/threads`;
  const created: PublicThreadApiCreateThreadResponse<string | null> = await (
    await post(createPath, createBody, "create")
  ).json();
  const threadId = parsePlatformId(created.thread.id, "Thread ID");
  await mkdir(input.outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(input.outputDirectory, "thread.json"), JSON.stringify(created, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify({ phase: "created", threadId }));
  const replay: PublicThreadApiCreateThreadResponse<string | null> = await (
    await post(createPath, createBody, "create")
  ).json();
  if (replay.thread.id !== threadId || created.thread.userId !== null)
    throw new Error("Create identity/idempotency contract failed.");
  if (
    created.thread.agent_id !==
    (input.configuration.type === "agent" ? input.configuration.agent_id : null)
  )
    throw new Error("Session configuration source does not match the request.");

  const state = async (): Promise<PublicThreadApiRetrieveThreadResponse<string | null>> =>
    (await call(`/threads/${threadId}`)).json();
  const waitForTerminal = async (expected: "completed" | "cancelled") => {
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      const current = await state();
      if (
        current.run &&
        ["completed", "failed", "cancelled", "expired"].includes(current.run.status)
      ) {
        if (current.run.status !== expected)
          throw new Error(
            `Expected ${expected}; received ${current.run.status}: ${current.run.error?.code ?? "no error code"}.`,
          );
        return current;
      }
      await Bun.sleep(2_000);
    }
    throw new Error(`Thread ${threadId} did not finish within eight minutes.`);
  };
  // On a fresh prefix this is the first turn. Use a fresh prefix for a complete rerun.
  await waitForTerminal("completed");

  const downloadArtifacts = async () => {
    const manifest: PublicThreadFileListResponse = await (
      await call(`/threads/${threadId}/files`)
    ).json();
    const bodies = new Map<string, string>();
    for (const file of manifest.files.toSorted(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )) {
      if (file.kind !== "artifact" || bodies.has(file.name)) continue;
      if (!file.committed) throw new Error("An artifact was returned before commitment.");
      bodies.set(file.name, await (await call(`/files/${file.id}/content`)).text());
    }
    return { manifest, bodies };
  };
  const initialArtifacts = await downloadArtifacts();
  for (const name of ["initial.json", "report.md", "chart.svg"]) {
    const body = initialArtifacts.bodies.get(name);
    if (!body) throw new Error(`First successful turn is missing ${name}.`);
    await writeFile(join(input.outputDirectory, `first-${name}`), body, { mode: 0o600 });
  }
  const original = JSON.parse(initialArtifacts.bodies.get("initial.json") ?? "null");
  if (original.grand_total !== 230 || !/^[0-9a-f]{64}$/.test(original.private_nonce_sha256))
    throw new Error("First-turn calculation/private hash is invalid.");
  if (!initialArtifacts.bodies.get("chart.svg")?.includes("<svg"))
    throw new Error("First-turn chart is invalid.");
  const initialEvents: PublicThreadApiListThreadEventsResponse = await (
    await call(`/threads/${threadId}/events?limit=1000`)
  ).json();
  if (
    !initialEvents.events.some(
      (event) => event.type === "tool.use.completed" && event.status === "available",
    )
  )
    throw new Error("First turn recorded no successful tool execution.");
  const initialEventIds = new Set(initialEvents.events.map((event) => event.id));
  await writeFile(
    join(input.outputDirectory, "first-evidence.json"),
    JSON.stringify({ files: initialArtifacts.manifest, events: initialEvents, original }, null, 2),
    { mode: 0o600 },
  );

  const sse = await call(`/threads/${threadId}/events/stream`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!sse.headers.get("content-type")?.includes("text/event-stream"))
    throw new Error("Expected SSE.");
  const reader = sse.body?.getReader();
  if (!reader) throw new Error("Missing SSE body.");
  let sseText = "";
  try {
    while (!sseText.includes("data:")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE ended without a persisted event.");
      sseText += new TextDecoder().decode(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  await writeFile(join(input.outputDirectory, "events.sse"), sseText, { mode: 0o600 });

  await post(`/threads/${threadId}/events`, SESSION_WORKFLOW_FOLLOWUP, "followup");
  await waitForTerminal("completed");
  const { manifest, bodies: artifactBodies } = await downloadArtifacts();
  for (const name of ["initial.json", "followup.json", "report.md", "chart.svg"]) {
    const body = artifactBodies.get(name);
    if (!body) throw new Error(`Missing artifact ${name}.`);
    await writeFile(join(input.outputDirectory, name), body, { mode: 0o600 });
  }
  const followup = JSON.parse(artifactBodies.get("followup.json") ?? "null");
  if (
    original.grand_total !== 230 ||
    followup.grand_total !== 250 ||
    !/^[0-9a-f]{64}$/.test(original.private_nonce_sha256) ||
    original.private_nonce_sha256 !== followup.private_nonce_sha256
  )
    throw new Error("Artifact calculation/private state validation failed.");
  if (!artifactBodies.get("chart.svg")?.includes("<svg")) throw new Error("Missing SVG chart.");
  const events: PublicThreadApiListThreadEventsResponse = await (
    await call(`/threads/${threadId}/events?limit=1000`)
  ).json();
  if (
    !events.events.some(
      (event) =>
        !initialEventIds.has(event.id) &&
        event.type === "tool.use.completed" &&
        event.status === "available",
    )
  )
    throw new Error("Follow-up recorded no new successful tool execution.");
  const followupEvents = events.events.filter((event) => !initialEventIds.has(event.id));
  // Some runtimes expose a tool result but no structured input. This is supporting
  // trace evidence; the independent first-turn hash remains the continuity check.
  if (
    !followupEvents.some(
      (event) =>
        (event.toolInput !== undefined &&
          /input\.csv|\.private|nonce/.test(JSON.stringify(event.toolInput))) ||
        (event.type === "tool.use.completed" &&
          event.status === "available" &&
          /input\.csv|\.private|nonce/.test(event.content)),
    )
  )
    throw new Error("Follow-up trace does not show a tool accessing the prior workspace material.");
  const usage = [];
  let after: string | null = null;
  do {
    const page: PublicThreadUsageResponse = await (
      await call(`/threads/${threadId}/usage${after === null ? "" : `?after=${after}`}`)
    ).json();
    usage.push(...page.usage);
    after = page.nextCursor;
  } while (after !== null);
  await writeFile(
    join(input.outputDirectory, "evidence.json"),
    JSON.stringify(
      { threadId, files: manifest, events, followupEvents, usage, original, followup },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  await post(`/threads/${threadId}/events`, CANCEL_WORK_INPUT, "cancel-work");
  await post(`/threads/${threadId}/events`, { events: [{ type: "user_interrupt" }] }, "cancel");
  const cancelled = await waitForTerminal("cancelled");
  await writeFile(
    join(input.outputDirectory, "cancelled.json"),
    JSON.stringify(cancelled, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      phase: "passed",
      threadId,
      usageRecords: usage.length,
      grandTotal: followup.grand_total,
      cancelled: true,
    }),
  );
}

if (import.meta.main) {
  loadRepoEnv();
  const agentId = process.env["MOSOO_PUBLIC_SESSION_AGENT_ID"]?.trim();
  const inlineFields = ["HARNESS", "PROVIDER", "MODEL", "INSTRUCTIONS"];
  if (
    agentId &&
    inlineFields.some((field) => process.env[`MOSOO_PUBLIC_SESSION_${field}`]?.trim())
  ) {
    throw new Error(
      "Select an Agent preset or inline harness/model configuration, without overrides.",
    );
  }
  await runSessionWorkflow({
    projectId: requireEnv("MOSOO_PUBLIC_SESSION_PROJECT_ID"),
    configuration: agentId
      ? { type: "agent", agent_id: parsePlatformId(agentId, "Agent ID") }
      : {
          type: "inline",
          harness: requireEnv("MOSOO_PUBLIC_SESSION_HARNESS"),
          provider: requireEnv("MOSOO_PUBLIC_SESSION_PROVIDER"),
          model: requireEnv("MOSOO_PUBLIC_SESSION_MODEL"),
          instructions:
            process.env["MOSOO_PUBLIC_SESSION_INSTRUCTIONS"]?.trim() ||
            "Use tools to analyze files, verify results and retain private working state for follow-up.",
        },
    baseUrl: assertNonProductionBaseUrl(requireEnv("MOSOO_PUBLIC_SESSION_BASE_URL"), "v2"),
    idempotencyPrefix: requireEnv("MOSOO_PUBLIC_SESSION_TEST_ID"),
    outputDirectory: process.env["MOSOO_PUBLIC_SESSION_OUTPUT_DIR"] ?? ".tmp/e2e/session-workflow",
    token: requireEnv("MOSOO_API_TOKEN"),
  });
}
