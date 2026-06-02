import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import type { AgentBuilderPlannerRunId, AgentBuilderThreadId, AgentId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getViewerFromRequest } from "../../auth/application/viewer-auth.service";
import {
  parseAgentBuilderPlannerRunId,
  parseAgentBuilderThreadId,
  parseAgentId,
} from "../application/agent-builder-ids";
import {
  assertAgentBuilderSystemAgentInstanceIdentity,
  parseAgentBuilderSystemAgentInstanceName,
} from "../application/agent-builder-system-agent-instance";
import type { AgentBuilderSystemAgentInstanceIdentity } from "../application/agent-builder-system-agent-instance";
import type { AgentBuilderSystemAgent } from "./agent-builder-system-agent.do";

export const AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX = "/agents/agent-builder-system-agent/";
export const AGENT_BUILDER_SYSTEM_AGENT_SDK_ROUTE_PREFIX = "api/agents";

export type AgentBuilderSystemAgentRpcOperation = "approve_starter_pack";

export interface AgentBuilderSystemAgentRpcRoute {
  readonly instanceName: string;
  readonly operation: AgentBuilderSystemAgentRpcOperation;
}

interface ApproveStarterPackBody {
  readonly agentId: AgentId;
  readonly mode: "batch" | "single";
  readonly nodeKey?: string | null;
  readonly plannerRunId: AgentBuilderPlannerRunId;
  readonly threadId: AgentBuilderThreadId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(input: Record<string, unknown>, fieldName: string): string {
  const value = input[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Agent Builder System Agent RPC field ${fieldName} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function readOptionalString(input: Record<string, unknown>, fieldName: string): string | null {
  const value = input[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Agent Builder System Agent RPC field ${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

function readApprovalMode(input: Record<string, unknown>): "batch" | "single" {
  const value = readRequiredString(input, "mode").toLowerCase();

  if (value !== "batch" && value !== "single") {
    throw new Error("Agent Builder System Agent RPC field mode must be batch or single.");
  }

  return value;
}

function parseApproveStarterPackBody(value: unknown): ApproveStarterPackBody {
  if (!isRecord(value)) {
    throw new Error("Agent Builder System Agent approval body must be an object.");
  }

  const nodeKey = readOptionalString(value, "nodeKey");

  return {
    agentId: parseAgentId(readRequiredString(value, "agentId"), "agentId"),
    mode: readApprovalMode(value),
    ...(nodeKey === null ? {} : { nodeKey }),
    plannerRunId: parseAgentBuilderPlannerRunId(
      readRequiredString(value, "plannerRunId"),
      "plannerRunId",
    ),
    threadId: parseAgentBuilderThreadId(readRequiredString(value, "threadId"), "threadId"),
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);

  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

async function readRpcJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Agent Builder System Agent RPC body must be valid JSON.");
  }
}

async function ensureApproveStarterPackInstanceAddress(input: {
  readonly bindings: ApiBindings;
  readonly body: ApproveStarterPackBody;
  readonly instance: AgentBuilderSystemAgentInstanceIdentity;
}): Promise<void> {
  assertAgentBuilderSystemAgentInstanceIdentity({
    bodyAgentId: input.body.agentId,
    bodyThreadId: input.body.threadId,
    instance: input.instance,
  });

  const row =
    (await input.bindings.DB.prepare(
      `
        SELECT agent_id, thread_id
        FROM agent_builder_planner_run
        WHERE id = ?
      `,
    )
      .bind(input.body.plannerRunId)
      .first<{ agent_id: string; thread_id: string }>()) ?? null;

  if (row === null) {
    throw new Error("Agent Builder System Agent plannerRunId was not found.");
  }

  const plannerRunAgentId = parseAgentId(row.agent_id, "planner run agentId");
  const plannerRunThreadId = parseAgentBuilderThreadId(row.thread_id, "planner run threadId");

  if (
    plannerRunAgentId !== input.instance.agentId ||
    plannerRunThreadId !== input.instance.threadId
  ) {
    throw new Error(
      "Agent Builder System Agent plannerRunId does not match the addressed instance.",
    );
  }
}

export function shouldRouteAgentBuilderSystemAgentRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;

  return path.startsWith(`${PUBLIC_API_PREFIX}${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}`);
}

export function parseAgentBuilderSystemAgentRpcRoute(
  request: Request,
): AgentBuilderSystemAgentRpcRoute | null {
  if (request.method !== "POST") {
    return null;
  }

  const prefix = `${PUBLIC_API_PREFIX}${AGENT_BUILDER_SYSTEM_AGENT_ROUTE_PREFIX}`;
  const path = new URL(request.url).pathname;

  if (!path.startsWith(prefix)) {
    return null;
  }

  const parts = path.slice(prefix.length).split("/");
  const instanceName = parts[0];
  const operationPath = `/${parts.slice(1).join("/")}`;

  if (instanceName === undefined || instanceName.length === 0) {
    return null;
  }

  if (operationPath === "/starter-pack/approve") {
    return {
      instanceName: decodeURIComponent(instanceName),
      operation: "approve_starter_pack",
    };
  }

  return null;
}

async function routeAgentBuilderSystemAgentRpcRequest(
  request: Request,
  bindings: ApiBindings,
): Promise<Response | null> {
  const route = parseAgentBuilderSystemAgentRpcRoute(request);

  if (route === null) {
    return null;
  }

  const viewer = await getViewerFromRequest(bindings, request);

  if (viewer === null) {
    return jsonResponse(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await readRpcJsonBody(request);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Invalid Agent Builder RPC body.",
      },
      { status: 400 },
    );
  }

  let input: ApproveStarterPackBody;

  try {
    input = parseApproveStarterPackBody(body);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Invalid Agent Builder RPC body.",
      },
      { status: 400 },
    );
  }

  let instance: AgentBuilderSystemAgentInstanceIdentity;

  try {
    instance = parseAgentBuilderSystemAgentInstanceName(route.instanceName);
    await ensureApproveStarterPackInstanceAddress({
      bindings,
      body: input,
      instance,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Invalid Agent Builder RPC instance.",
      },
      { status: 400 },
    );
  }

  if (bindings.AgentBuilderSystemAgent === undefined) {
    return jsonResponse(
      {
        error: "Agent Builder System Agent binding is not configured.",
      },
      { status: 503 },
    );
  }

  const { getAgentByName } = await import("agents");
  const agent = await getAgentByName<ApiBindings, AgentBuilderSystemAgent>(
    bindings.AgentBuilderSystemAgent,
    route.instanceName,
  );

  return jsonResponse(
    await agent.approveStarterPack({
      ...input,
      viewer,
    }),
  );
}

export async function routeAgentBuilderSystemAgentRequest(
  request: Request,
  bindings: ApiBindings,
): Promise<Response | null> {
  if (!shouldRouteAgentBuilderSystemAgentRequest(request)) {
    return null;
  }

  const rpcResponse = await routeAgentBuilderSystemAgentRpcRequest(request, bindings);

  if (rpcResponse !== null) {
    return rpcResponse;
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
