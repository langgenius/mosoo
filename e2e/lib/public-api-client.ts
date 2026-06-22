import type { Page } from "@playwright/test";

import { TURN_TIMEOUT_MS } from "./runtime-progress";
import type { LatencyTraceEvent } from "./runtime-progress";

export interface PublicApiCreateThreadLatency {
  createThreadAcceptedMs: number;
  createSessionMs: number;
  firstAssistantTextMs: number;
  label: string;
  sessionId: string;
  tokenCompletedMs: number;
  trace: LatencyTraceEvent[];
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
        createThreadAcceptedMs: number;
        createSessionMs: number;
        firstAssistantTextMs: number;
        label: string;
        sessionId: string;
        tokenCompletedMs: number;
        trace: BrowserLatencyTraceEvent[];
      }

      interface BrowserPublicThreadEvent {
        content: string;
        id: string;
        status: string | null;
        type: string;
      }

      const round = (value: number) => Math.max(0, Math.round(value));
      const delay = async (ms: number): Promise<void> =>
        new Promise((resolve) => {
          window.setTimeout(resolve, ms);
        });
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
      const readThreadEvents = async (threadId: string): Promise<BrowserPublicThreadEvent[]> => {
        const response = await fetch(
          `/api/v1/threads/${encodeURIComponent(threadId)}/events?limit=100`,
          {
            headers: {
              Authorization: `Bearer ${pat}`,
            },
          },
        );
        const payload = await requireOk(response, "public API list thread events");

        if (!isObject(payload) || !Array.isArray(payload["events"])) {
          throw new Error("Public API thread events response did not include events.");
        }

        return payload["events"].flatMap((event) => {
          const parsed = readThreadEvent(event);

          return parsed === null ? [] : [parsed];
        });
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
      let assistantText = "";
      let firstAssistantTextMs: number | null = null;
      let tokenCompletedMs: number | null = null;
      const createThreadAcceptedMs = createSessionMs;
      const deadline = createStartedAt + timeoutMs;

      while (performance.now() < deadline && tokenCompletedMs === null) {
        const events = await readThreadEvents(threadId);

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

          if (event.type === "run.failed") {
            throw new Error("Public API run failed before producing the expected token.");
          }

          if (!event.type.startsWith("agent.message") || event.content.trim().length === 0) {
            continue;
          }

          if (firstAssistantTextMs === null) {
            firstAssistantTextMs = elapsedMs;
          }

          assistantText += event.content;

          if (assistantText.includes(expectedToken)) {
            tokenCompletedMs = elapsedMs;
            break;
          }
        }

        if (tokenCompletedMs === null) {
          await delay(250);
        }
      }

      if (firstAssistantTextMs === null || tokenCompletedMs === null) {
        throw new Error(
          `Public API thread events did not include ${expectedToken} within ${timeoutMs}ms.`,
        );
      }

      return {
        createThreadAcceptedMs,
        createSessionMs,
        firstAssistantTextMs,
        label,
        sessionId: threadId,
        tokenCompletedMs,
        trace,
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
