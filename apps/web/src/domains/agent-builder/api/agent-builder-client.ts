import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  OrganizationId,
} from "@mosoo/contracts/id";
import { parseNullablePlatformId, parsePlatformId } from "@mosoo/id";

import { requestGraphQL } from "@/platform/http/graphql-client";
import { apiFetch } from "@/platform/http/public-api";
import type { ApiPath } from "@/platform/http/public-api";

import {
  AGENT_BUILDER_MESSAGES_QUERY,
  ENSURE_AGENT_BUILDER_THREAD_MUTATION,
} from "./agent-builder-documents";
import type { AgentBuilderSystemAgentAddress } from "./agent-builder-transport";

export interface AgentBuilderThread {
  agentId: AgentId;
  createdAt: string;
  creatorAccountId: AccountId;
  id: AgentBuilderThreadId;
  lastTurnAt: string | null;
  organizationId: OrganizationId;
  status: string;
  title: string | null;
  updatedAt: string;
}

export type AgentBuilderClientMessageId = AgentBuilderMessageId | string;

export interface AgentBuilderMessage {
  cardsJson: string | null;
  contentText: string;
  createdAt: string;
  createdByAccountId: AccountId | null;
  id: AgentBuilderClientMessageId;
  inputKind: string | null;
  plannerRunId: AgentBuilderPlannerRunId | null;
  role: string;
  seq: number;
  threadId: AgentBuilderThreadId;
}

export interface AgentBuilderStarterPackApprovalInput {
  mode: "BATCH" | "SINGLE";
  nodeKey?: string | null;
  plannerRunId: AgentBuilderPlannerRunId;
}

export async function approveAgentBuilderStarterPack(input: {
  agentId: AgentId;
  approval: AgentBuilderStarterPackApprovalInput;
  systemAgent: AgentBuilderSystemAgentAddress | null;
}): Promise<AgentBuilderMessage[]> {
  if (input.systemAgent === null) {
    throw new Error("Agent Builder session is not ready.");
  }

  return approveAgentBuilderSystemAgentStarterPack({
    agentId: input.agentId,
    approval: input.approval,
    systemAgent: input.systemAgent,
  });
}

async function approveAgentBuilderSystemAgentStarterPack(input: {
  agentId: AgentId;
  approval: AgentBuilderStarterPackApprovalInput;
  systemAgent: AgentBuilderSystemAgentAddress;
}): Promise<AgentBuilderMessage[]> {
  const payload = await requestSystemAgentRpc({
    body: {
      agentId: input.agentId,
      mode: input.approval.mode === "BATCH" ? "batch" : "single",
      nodeKey: input.approval.nodeKey ?? null,
      plannerRunId: input.approval.plannerRunId,
      threadId: input.systemAgent.threadId,
    },
    path: createSystemAgentRpcPath(input.systemAgent, "starter-pack/approve"),
  });

  return payload.messages;
}

export async function ensureAgentBuilderThread(agentId: AgentId): Promise<AgentBuilderThread> {
  const payload = await requestGraphQL(ENSURE_AGENT_BUILDER_THREAD_MUTATION, { agentId });
  return parseAgentBuilderThread(payload.ensureAgentBuilderThread);
}

export async function listAgentBuilderMessages(input: {
  agentId: AgentId;
  beforeSeq?: number | null;
  limit?: number | null;
}): Promise<AgentBuilderMessage[]> {
  const payload = await requestGraphQL(AGENT_BUILDER_MESSAGES_QUERY, input);
  return payload.agentBuilderMessages.map(parseAgentBuilderMessage);
}

function createSystemAgentRpcPath(
  systemAgent: AgentBuilderSystemAgentAddress,
  operationPath: "starter-pack/approve",
): ApiPath {
  if (!systemAgent.publicPath.startsWith("/api/")) {
    throw new Error("Agent Builder is not configured correctly.");
  }

  return `${systemAgent.publicPath.slice("/api".length)}/${operationPath}` as ApiPath;
}

async function readSystemAgentHttpError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);

  if (
    payload !== null &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return `${response.status} ${response.statusText}`;
}

function parseAgentBuilderThread(thread: {
  agentId: string;
  createdAt: string;
  creatorAccountId: string;
  id: string;
  lastTurnAt: string | null;
  organizationId: string;
  status: string;
  title: string | null;
  updatedAt: string;
}): AgentBuilderThread {
  return {
    agentId: parsePlatformId<AgentId>(thread.agentId, "Agent ID"),
    createdAt: thread.createdAt,
    creatorAccountId: parsePlatformId<AccountId>(thread.creatorAccountId, "Account ID"),
    id: parsePlatformId<AgentBuilderThreadId>(thread.id, "Agent Builder thread ID"),
    lastTurnAt: thread.lastTurnAt,
    organizationId: parsePlatformId<OrganizationId>(thread.organizationId, "Organization ID"),
    status: thread.status,
    title: thread.title,
    updatedAt: thread.updatedAt,
  };
}

function parseAgentBuilderMessage(message: {
  cardsJson: string | null;
  contentText: string;
  createdAt: string;
  createdByAccountId: string | null;
  id: string;
  inputKind: string | null;
  plannerRunId: string | null;
  role: string;
  seq: number;
  threadId: string;
}): AgentBuilderMessage {
  return {
    cardsJson: message.cardsJson,
    contentText: message.contentText,
    createdAt: message.createdAt,
    createdByAccountId: parseNullablePlatformId<AccountId>(
      message.createdByAccountId,
      "Account ID",
    ),
    id: parsePlatformId<AgentBuilderMessageId>(message.id, "Agent Builder message ID"),
    inputKind: message.inputKind,
    plannerRunId: parseNullablePlatformId<AgentBuilderPlannerRunId>(
      message.plannerRunId,
      "Agent Builder planner run ID",
    ),
    role: message.role,
    seq: message.seq,
    threadId: parsePlatformId<AgentBuilderThreadId>(message.threadId, "Agent Builder thread ID"),
  };
}

function readSystemAgentRpcMessages(payload: unknown): AgentBuilderMessage[] {
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("messages" in payload) ||
    !Array.isArray(payload.messages)
  ) {
    throw new Error("Agent Builder response did not include messages.");
  }

  return payload.messages.map(parseAgentBuilderMessage);
}

async function requestSystemAgentRpc(input: {
  body: Record<string, unknown>;
  path: ApiPath;
}): Promise<{ messages: AgentBuilderMessage[] }> {
  const response = await apiFetch(input.path, {
    body: JSON.stringify(input.body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const message = await readSystemAgentHttpError(response);

    throw new Error(message);
  }

  return {
    messages: readSystemAgentRpcMessages(await response.json()),
  };
}
