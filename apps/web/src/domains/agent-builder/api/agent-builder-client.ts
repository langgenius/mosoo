import type { AgentBuilderSecureUiAction } from "@mosoo/contracts/agent-builder";
import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  OrganizationId,
  SessionId,
} from "@mosoo/contracts/id";
import { parseNullablePlatformId, parsePlatformId } from "@mosoo/id";

import type {
  AgentBuilderControlPlaneActionStatus,
  AgentBuilderExecutableActionToolId,
  ExecuteAgentBuilderControlPlaneActionInput,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import {
  AGENT_BUILDER_MESSAGES_QUERY,
  ENSURE_AGENT_BUILDER_THREAD_MUTATION,
  EXECUTE_AGENT_BUILDER_CONTROL_PLANE_ACTION_MUTATION,
} from "./agent-builder-documents";

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

export interface AgentBuilderControlPlaneActionResult {
  message: string;
  secureUi: AgentBuilderSecureUiAction | null;
  sessionId: SessionId | null;
  status: AgentBuilderControlPlaneActionStatus;
  toolId: AgentBuilderExecutableActionToolId;
}

export async function ensureAgentBuilderThread(agentId: AgentId): Promise<AgentBuilderThread> {
  const payload = await requestGraphQL(ENSURE_AGENT_BUILDER_THREAD_MUTATION, { agentId });
  return parseAgentBuilderThread(payload.ensureAgentBuilderThread);
}

export async function executeAgentBuilderControlPlaneAction(
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  const payload = await requestGraphQL(EXECUTE_AGENT_BUILDER_CONTROL_PLANE_ACTION_MUTATION, {
    input,
  });
  return parseAgentBuilderControlPlaneActionResult(payload.executeAgentBuilderControlPlaneAction);
}

export async function listAgentBuilderMessages(input: {
  agentId: AgentId;
  beforeSeq?: number | null;
  limit?: number | null;
}): Promise<AgentBuilderMessage[]> {
  const payload = await requestGraphQL(AGENT_BUILDER_MESSAGES_QUERY, input);
  return payload.agentBuilderMessages.map(parseAgentBuilderMessage);
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

function parseAgentBuilderControlPlaneActionResult(result: {
  message: string;
  secureUi: { kind: AgentBuilderSecureUiAction["kind"] } | null;
  sessionId: string | null;
  status: AgentBuilderControlPlaneActionStatus;
  toolId: AgentBuilderExecutableActionToolId;
}): AgentBuilderControlPlaneActionResult {
  return {
    message: result.message,
    secureUi: result.secureUi,
    sessionId: parseNullablePlatformId<SessionId>(result.sessionId, "Session ID"),
    status: result.status,
    toolId: result.toolId,
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
