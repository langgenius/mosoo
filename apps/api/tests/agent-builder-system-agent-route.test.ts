import { describe, expect, test } from "bun:test";

import { parseAgentBuilderSystemAgentInstanceName } from "../src/modules/agent-builder/application/agent-builder-system-agent-instance";
import {
  AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX,
  AGENT_BUILDER_SYSTEM_AGENT_SDK_ROUTE_PREFIX,
  parseAgentBuilderSystemAgentRpcRoute,
  shouldRouteAgentBuilderSystemAgentRequest,
} from "../src/modules/agent-builder/infrastructure/agent-builder-system-agent-route";

const ROUTE_AGENT_ID = "01J000000000000000000000G1";
const ROUTE_THREAD_ID = "01J000000000000000000000G2";

function request(path: string): Request {
  return new Request(`http://localhost:8787${path}`);
}

function instanceName(input: { agentId: string; threadId: string }): string {
  return `agent:${input.agentId}:thread:${input.threadId}`;
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
          )}/legacy-rpc/approve`,
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
          )}/legacy-rpc/approve`,
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
          )}`,
        ),
      ),
    ).toBeNull();
  });

  test("parses encoded SDK instance names from Agent Builder WebSocket routes", () => {
    const parsed = parseAgentBuilderSystemAgentInstanceName(
      encodeURIComponent(instanceName({ agentId: ROUTE_AGENT_ID, threadId: ROUTE_THREAD_ID })),
    );

    expect(parsed).toEqual({
      agentId: ROUTE_AGENT_ID,
      threadId: ROUTE_THREAD_ID,
    });
  });
});
