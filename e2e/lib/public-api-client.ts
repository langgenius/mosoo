import type { Page } from "@playwright/test";

import { TURN_TIMEOUT_MS } from "./runtime-progress";
import type { LatencyTraceEvent } from "./runtime-progress";

export interface PublicApiCreateThreadLatency {
  assistantChunkCount: number;
  createThreadAcceptedMs: number;
  createSessionMs: number;
  firstAssistantTextMs: number;
  interChunkMaxMs: number | null;
  interChunkP50Ms: number | null;
  interChunkP95Ms: number | null;
  label: string;
  pauseOver250MsCount: number;
  pauseOver500MsCount: number;
  runCompletedMs: number;
  sessionId: string;
  streamConnectedMs: number;
  streamFirstByteMs: number;
  streamHandshakeMs: number;
  tokenCompletedMs: number;
  trace: LatencyTraceEvent[];
  usageTotalTokens: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function createPersonalAccessTokenForPublicApi(
  page: Page,
  input: {
    label: string;
  },
): Promise<string> {
  const response = await page.request.post("/api/access-tokens", {
    data: { label: input.label },
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok()) {
    throw new Error(
      `Could not create public API token: ${response.status()} ${JSON.stringify(payload)}`,
    );
  }

  if (!isRecord(payload) || typeof payload["value"] !== "string") {
    throw new Error("Public API token response did not include a token value.");
  }

  return payload["value"];
}

export async function publishAgentForPublicApi(
  page: Page,
  input: {
    agentId: string;
  },
): Promise<void> {
  const response = await page.request.post("/api/graphql", {
    data: {
      query: `
        mutation PublishLatencyAgent($input: PublishAgentInput!) {
          publishAgent(input: $input) {
            id
            status
          }
        }
      `,
      variables: {
        input: {
          agentId: input.agentId,
          visibility: "private",
        },
      },
    },
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok()) {
    throw new Error(
      `Could not publish latency agent: ${response.status()} ${JSON.stringify(payload)}`,
    );
  }

  if (isRecord(payload) && Array.isArray(payload["errors"])) {
    throw new Error(`Could not publish latency agent: ${JSON.stringify(payload["errors"])}`);
  }
}

export async function runPublicApiCreateThreadLatency(
  page: Page,
  input: {
    agentId: string;
    expectedToken: string;
    label: string;
    pat: string;
  },
): Promise<PublicApiCreateThreadLatency> {
  return page.evaluate(
    async ({ agentId, expectedToken, label, pat, timeoutMs }) => {
      interface BrowserLatencyTraceEvent {
        elapsedMs: number;
        name: string | null;
        runStatus: string | null;
        type: string | null;
      }

      interface BrowserPublicApiLatency {
        assistantChunkCount: number;
        createThreadAcceptedMs: number;
        createSessionMs: number;
        firstAssistantTextMs: number;
        interChunkMaxMs: number | null;
        interChunkP50Ms: number | null;
        interChunkP95Ms: number | null;
        label: string;
        pauseOver250MsCount: number;
        pauseOver500MsCount: number;
        runCompletedMs: number;
        sessionId: string;
        streamConnectedMs: number;
        streamFirstByteMs: number;
        streamHandshakeMs: number;
        tokenCompletedMs: number;
        trace: BrowserLatencyTraceEvent[];
        usageTotalTokens: number | null;
      }

      interface BrowserPublicThreadEvent {
        content: string;
        id: string;
        status: string | null;
        tokens: number | null;
        type: string;
      }

      const round = (value: number) => Math.max(0, Math.round(value));
      const percentile = (values: number[], percentage: number): number | null => {
        if (values.length === 0) {
          return null;
        }

        const sorted = values.toSorted((a, b) => a - b);
        const index = Math.min(
          sorted.length - 1,
          Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
        );

        return round(sorted[index] ?? 0);
      };
      const readJson = async (response: Response): Promise<unknown> => response.json();
      const isObject = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === "object" && !Array.isArray(value);
      const readStringField = (record: Record<string, unknown>, field: string): string | null => {
        const value = record[field];

        return typeof value === "string" ? value : null;
      };
      const readThreadEvent = (value: unknown): BrowserPublicThreadEvent | null => {
        if (!isObject(value)) {
          return null;
        }

        const content = readStringField(value, "content");
        const id = readStringField(value, "id");
        const type = readStringField(value, "type");

        if (content === null || id === null || type === null) {
          return null;
        }

        return {
          content,
          id,
          status: readStringField(value, "status"),
          tokens: typeof value["tokens"] === "number" ? value["tokens"] : null,
          type,
        };
      };
      const requireOk = async (response: Response, action: string): Promise<unknown> => {
        const payload = await readJson(response).catch(() => null);

        if (!response.ok) {
          throw new Error(`${action} failed: ${response.status} ${JSON.stringify(payload)}`);
        }

        return payload;
      };
      const readSseBlock = (block: string): BrowserPublicThreadEvent | null => {
        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of block.split(/\r?\n/u)) {
          if (line.startsWith("event:")) {
            eventName = line.slice("event:".length).trimStart();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trimStart());
          }
        }

        if (eventName === "thread.error") {
          throw new Error(`Public API event stream failed: ${dataLines.join("\n")}`);
        }

        if (eventName !== "thread.event" || dataLines.length === 0) {
          return null;
        }

        return readThreadEvent(JSON.parse(dataLines.join("\n")));
      };
      const createStartedAt = performance.now();
      const prompt = `Reply with exactly ${expectedToken}. Do not use tools.`;
      const createResponse = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/threads`, {
        body: JSON.stringify({
          input: {
            content: [
              {
                text: prompt,
                type: "text",
              },
            ],
            type: "user.message",
          },
        }),
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `e2e-create-${label}-${Date.now()}`,
        },
        method: "POST",
      });
      const createPayload = await requireOk(createResponse, "public API create thread");
      const createSessionMs = round(performance.now() - createStartedAt);

      if (!isObject(createPayload) || !isObject(createPayload["thread"])) {
        throw new Error("Public API create thread response did not include a thread.");
      }

      const threadId = createPayload["thread"]["id"];

      if (typeof threadId !== "string") {
        throw new Error("Public API create thread response did not include thread.id.");
      }

      const trace: BrowserLatencyTraceEvent[] = [];
      const seenEventIds = new Set<string>();
      const assistantChunkTimestamps: number[] = [];
      let assistantText = "";
      let firstAssistantTextMs: number | null = null;
      let usageTotalTokens: number | null = null;
      let runCompletedMs: number | null = null;
      let streamFirstByteMs: number | null = null;
      let tokenCompletedMs: number | null = null;
      const createThreadAcceptedMs = createSessionMs;
      const deadline = createStartedAt + timeoutMs;
      const streamStartedAt = performance.now();
      const streamController = new AbortController();
      const streamResponse = await fetch(
        `/api/v1/threads/${encodeURIComponent(threadId)}/events/stream?limit=100`,
        {
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${pat}`,
          },
          signal: streamController.signal,
        },
      );

      if (!streamResponse.ok) {
        await requireOk(streamResponse, "public API stream thread events");
      }

      const streamConnectedMs = round(performance.now() - createStartedAt);
      const streamHandshakeMs = round(performance.now() - streamStartedAt);
      const reader = streamResponse.body?.getReader();

      if (!reader) {
        throw new Error("Public API event stream did not include a readable body.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (
          performance.now() < deadline &&
          (tokenCompletedMs === null || runCompletedMs === null)
        ) {
          const chunk = await reader.read();

          if (chunk.done) {
            throw new Error("Public API event stream closed before the Run completed.");
          }

          if (streamFirstByteMs === null) {
            streamFirstByteMs = round(performance.now() - createStartedAt);
          }

          buffer += decoder.decode(chunk.value, { stream: true });
          const events: BrowserPublicThreadEvent[] = [];

          for (;;) {
            const separator = /\r?\n\r?\n/u.exec(buffer);

            if (separator === null) {
              break;
            }

            const block = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            const event = readSseBlock(block);

            if (event !== null) {
              events.push(event);
            }
          }

          for (const event of events) {
            if (seenEventIds.has(event.id)) {
              continue;
            }

            seenEventIds.add(event.id);
            const elapsedMs = round(performance.now() - createStartedAt);
            trace.push({
              elapsedMs,
              name: event.type,
              runStatus: event.type.startsWith("run.") ? event.type.slice("run.".length) : null,
              type: event.type,
            });

            if (event.tokens !== null) {
              usageTotalTokens = Math.max(usageTotalTokens ?? 0, event.tokens);
            }

            if (event.type === "run.failed") {
              throw new Error("Public API run failed before producing the expected token.");
            }

            if (event.type === "run.completed") {
              runCompletedMs = elapsedMs;
            }

            if (!event.type.startsWith("agent.message") || event.content.length === 0) {
              continue;
            }

            if (firstAssistantTextMs === null) {
              firstAssistantTextMs = elapsedMs;
            }

            assistantChunkTimestamps.push(performance.now());
            assistantText += event.content;

            if (assistantText.includes(expectedToken)) {
              tokenCompletedMs ??= elapsedMs;
            }
          }
        }
      } finally {
        streamController.abort();
        await reader.cancel().catch(() => {});
      }

      if (
        firstAssistantTextMs === null ||
        runCompletedMs === null ||
        streamFirstByteMs === null ||
        tokenCompletedMs === null
      ) {
        throw new Error(
          `Public API event stream did not complete ${expectedToken} within ${timeoutMs}ms.`,
        );
      }

      const interChunkGaps = assistantChunkTimestamps
        .slice(1)
        .map((timestamp, index) => timestamp - (assistantChunkTimestamps[index] ?? timestamp));
      return {
        assistantChunkCount: assistantChunkTimestamps.length,
        createThreadAcceptedMs,
        createSessionMs,
        firstAssistantTextMs,
        interChunkMaxMs: interChunkGaps.length === 0 ? null : round(Math.max(...interChunkGaps)),
        interChunkP50Ms: percentile(interChunkGaps, 50),
        interChunkP95Ms: percentile(interChunkGaps, 95),
        label,
        pauseOver250MsCount: interChunkGaps.filter((gap) => gap > 250).length,
        pauseOver500MsCount: interChunkGaps.filter((gap) => gap > 500).length,
        runCompletedMs,
        sessionId: threadId,
        streamConnectedMs,
        streamFirstByteMs,
        streamHandshakeMs,
        tokenCompletedMs,
        trace,
        usageTotalTokens,
      } satisfies BrowserPublicApiLatency;
    },
    {
      agentId: input.agentId,
      expectedToken: input.expectedToken,
      label: input.label,
      pat: input.pat,
      timeoutMs: TURN_TIMEOUT_MS,
    },
  );
}
