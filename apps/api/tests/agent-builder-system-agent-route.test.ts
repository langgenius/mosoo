import { describe, expect, test } from "bun:test";

import {
  AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX,
  AGENT_BUILDER_SYSTEM_AGENT_SDK_ROUTE_PREFIX,
  parseAgentBuilderSystemAgentRpcRoute,
  routeAgentBuilderSystemAgentRequest,
  shouldRouteAgentBuilderSystemAgentRequest,
} from "../src/modules/agent-builder/infrastructure/agent-builder-system-agent-route";
import type { AgentBuilderSystemAgentRpcRoute } from "../src/modules/agent-builder/infrastructure/agent-builder-system-agent-route";
import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

const ROUTE_AGENT_ID = "01J000000000000000000000G1";
const ROUTE_THREAD_ID = "01J000000000000000000000G2";
const ROUTE_OTHER_AGENT_ID = "01J000000000000000000000G3";
const ROUTE_OTHER_THREAD_ID = "01J000000000000000000000G4";
const ROUTE_PLANNER_RUN_ID = "01J000000000000000000000G5";

function request(path: string): Request {
  return new Request(`http://localhost:8787${path}`);
}

function instanceName(input: { agentId: string; threadId: string }): string {
  return `agent:${input.agentId}:thread:${input.threadId}`;
}

function systemAgentRpcRequest(input: {
  body: Record<string, unknown>;
  headers?: HeadersInit;
  instanceName: string;
}): Request {
  const headers = new Headers(input.headers);

  headers.set("content-type", "application/json");

  return new Request(
    `http://localhost:8787/api${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}${encodeURIComponent(
      input.instanceName,
    )}/starter-pack/approve`,
    {
      body: JSON.stringify(input.body),
      headers,
      method: "POST",
    },
  );
}

describe("Agent Builder System Agent route admission", () => {
  test("routes only the Agent Builder System Agent path", () => {
    expect(
      shouldRouteAgentBuilderSystemAgentRequest(
        request(`/api${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}draft-1`),
      ),
    ).toBe(true);
    expect(shouldRouteAgentBuilderSystemAgentRequest(request("/api/graphql"))).toBe(false);
  });

  test("parses System Agent JSON RPC operation routes without capturing SDK traffic", () => {
    expect(
      parseAgentBuilderSystemAgentRpcRoute(
        new Request(
          `http://localhost:8787/api${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}${encodeURIComponent(
            instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
          )}/message`,
          {
            method: "POST",
          },
        ),
      ),
    ).toBeNull();
    expect(
      parseAgentBuilderSystemAgentRpcRoute(
        new Request(
          `http://localhost:8787/${AGENT_BUILDER_SYSTEM_AGENT_SDK_ROUTE_PREFIX}/${encodeURIComponent(
            instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
          )}/starter-pack/approve`,
          {
            method: "POST",
          },
        ),
      ),
    ).toBeNull();
    expect(
      parseAgentBuilderSystemAgentRpcRoute(
        new Request(
          `http://localhost:8787/api${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}${encodeURIComponent(
            instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
          )}/starter-pack/approve`,
          {
            method: "POST",
          },
        ),
      ) satisfies AgentBuilderSystemAgentRpcRoute | null,
    ).toEqual({
      instanceName: instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
      operation: "approve_starter_pack",
    });
    expect(
      parseAgentBuilderSystemAgentRpcRoute(
        new Request(
          `http://localhost:8787/api${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}${encodeURIComponent(
            instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
          )}`,
        ),
      ),
    ).toBeNull();
  });

  test("requires authentication before exposing RPC binding state", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const response = await routeAgentBuilderSystemAgentRequest(
      systemAgentRpcRequest({
        body: {
          agentId: ROUTE_AGENT_ID,
          mode: "batch",
          plannerRunId: ROUTE_PLANNER_RUN_ID,
          threadId: ROUTE_THREAD_ID,
        },
        instanceName: instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
      }),
      fixture.bindings,
    );

    expect(response?.status).toBe(401);
  });

  test("rejects authenticated RPC requests whose body Agent does not match the instance", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await fixture.client.loginAsMosooAiTestAccount();
    const response = await routeAgentBuilderSystemAgentRequest(
      systemAgentRpcRequest({
        body: {
          agentId: ROUTE_OTHER_AGENT_ID,
          mode: "batch",
          plannerRunId: ROUTE_PLANNER_RUN_ID,
          threadId: ROUTE_THREAD_ID,
        },
        headers: fixture.client.sessionHeaders(),
        instanceName: instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
      }),
      fixture.bindings,
    );

    expect(response?.status).toBe(400);
  });

  test("rejects authenticated RPC requests whose body thread does not match the instance", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await fixture.client.loginAsMosooAiTestAccount();
    const response = await routeAgentBuilderSystemAgentRequest(
      systemAgentRpcRequest({
        body: {
          agentId: ROUTE_AGENT_ID,
          mode: "batch",
          plannerRunId: ROUTE_PLANNER_RUN_ID,
          threadId: ROUTE_OTHER_THREAD_ID,
        },
        headers: fixture.client.sessionHeaders(),
        instanceName: instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID }),
      }),
      fixture.bindings,
    );

    expect(response?.status).toBe(400);
  });
});
