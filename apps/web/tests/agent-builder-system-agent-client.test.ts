import { afterEach, describe, expect, test } from "bun:test";

import type { AgentBuilderMessage } from "../src/domains/agent-builder/api/agent-builder-client";
import { approveAgentBuilderStarterPack } from "../src/domains/agent-builder/api/agent-builder-client";
import { createAgentBuilderSystemAgentAddress } from "../src/domains/agent-builder/api/agent-builder-transport";

const originalFetch = globalThis.fetch;
const AGENT_ID = "01J000000000000000000000A1";
const THREAD_ID = "01J000000000000000000000A2";
const VIEWER_ID = "01J000000000000000000000A3";
const MESSAGE_ID = "01J000000000000000000000A4";
const PLANNER_RUN_ID = "01J000000000000000000000A5";

const systemAgent = createAgentBuilderSystemAgentAddress({
  agentId: AGENT_ID,
  threadId: THREAD_ID,
});

const messages: AgentBuilderMessage[] = [
  {
    cardsJson: null,
    contentText: "hello",
    createdAt: "2026-05-25T00:00:00.000Z",
    createdByAccountId: VIEWER_ID,
    id: MESSAGE_ID,
    inputKind: "user_message",
    plannerRunId: PLANNER_RUN_ID,
    role: "user",
    seq: 1,
    threadId: THREAD_ID,
  },
];

async function readRequestBodyJson(init: RequestInit | undefined): Promise<unknown> {
  if (typeof init?.body === "string") {
    return JSON.parse(init.body);
  }

  if (init?.body instanceof Blob) {
    return JSON.parse(await init.body.text());
  }

  throw new Error("Expected request body to be serialized JSON.");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Agent Builder System Agent client", () => {
  test("submits Starter Pack approvals to the System Agent approval endpoint", async () => {
    let capturedInput: RequestInfo | URL | null = null;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;

      return Response.json({
        messages,
        state: {
          draftId: AGENT_ID,
        },
      });
    };

    await expect(
      approveAgentBuilderStarterPack({
        agentId: AGENT_ID,
        approval: {
          mode: "BATCH",
          nodeKey: null,
          plannerRunId: PLANNER_RUN_ID,
        },
        systemAgent,
      }),
    ).resolves.toEqual(messages);

    expect(capturedInput).toBe(`${systemAgent.publicPath}/starter-pack/approve`);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(await readRequestBodyJson(capturedInit)).toEqual({
      agentId: AGENT_ID,
      mode: "batch",
      nodeKey: null,
      plannerRunId: PLANNER_RUN_ID,
      threadId: THREAD_ID,
    });
  });

  test("requires the Agent Builder session transport for Starter Pack approvals", async () => {
    await expect(
      approveAgentBuilderStarterPack({
        agentId: AGENT_ID,
        approval: {
          mode: "SINGLE",
          nodeKey: "node_1",
          plannerRunId: PLANNER_RUN_ID,
        },
        systemAgent: null,
      }),
    ).rejects.toThrow();
  });
});
