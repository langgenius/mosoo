import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getViewerFromRequest } from "../../auth/application/viewer-auth.service";

export const AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX = "/agents/agent-builder-system-agent/";
export const AGENT_BUILDER_SYSTEM_AGENT_SDK_ROUTE_PREFIX = "api/agents";

export type AgentBuilderSystemAgentRpcOperation = never;

export interface AgentBuilderSystemAgentRpcRoute {
  readonly instanceName: string;
  readonly operation: AgentBuilderSystemAgentRpcOperation;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);

  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function shouldRouteAgentBuilderSystemAgentRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;

  return path.startsWith(`${PUBLIC_API_PREFIX}${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}`);
}

export function parseAgentBuilderSystemAgentRpcRoute(
  _request: Request,
): AgentBuilderSystemAgentRpcRoute | null {
  return null;
}

export async function routeAgentBuilderSystemAgentRequest(
  request: Request,
  bindings: ApiBindings,
): Promise<Response | null> {
  if (!shouldRouteAgentBuilderSystemAgentRequest(request)) {
    return null;
  }

  const { routeAgentRequest } = await import("agents");

  return routeAgentRequest(request, bindings, {
    onBeforeConnect: async (agentRequest) => {
      const viewer = await getViewerFromRequest(bindings, agentRequest);

      return viewer === null
        ? jsonResponse({ error: "Authentication required." }, { status: 401 })
        : agentRequest;
    },
    onBeforeRequest: async (agentRequest) => {
      const viewer = await getViewerFromRequest(bindings, agentRequest);

      return viewer === null
        ? jsonResponse({ error: "Authentication required." }, { status: 401 })
        : agentRequest;
    },
    prefix: AGENT_BUILDER_SYSTEM_AGENT_SDK_ROUTE_PREFIX,
  });
}
