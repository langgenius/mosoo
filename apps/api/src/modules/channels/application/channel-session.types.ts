import type { PrimitiveRecord } from "@mosoo/contracts";
import type { AgentChannelBindingProvider } from "@mosoo/db";
import type { AgentId, ChannelBindingId, SessionId, SessionRunId } from "@mosoo/id";

import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { ChannelAgentReplyResult } from "./channel-agent-reply";

export interface AgentChannelBindingContext {
  agentId: AgentId;
  agentStatus: AgentRow["status"];
  bindingId: ChannelBindingId;
  credentialsJson: string;
  displayMetadata: PrimitiveRecord;
  externalBotId: string;
  externalTenantId: string;
  owner: AuthenticatedViewer;
  provider: AgentChannelBindingProvider;
}

export interface ChannelWorkTrigger {
  auditActorDisplay: string;
  auditActorId: string;
  eventId: string;
  externalActorId: string;
  externalMessageId: string;
  externalThreadId: string;
  externalWorkspaceId?: string | null;
  providerMetadata: PrimitiveRecord;
  requiresExistingSession: boolean;
}

export interface ChannelSessionCommandClient {
  createOrContinueSession(input: {
    clientRequestId: string;
    text: string;
    trigger: ChannelWorkTrigger;
  }): Promise<{
    duplicate: boolean;
    ignored?: boolean;
    runId: SessionRunId | null;
    sessionId: SessionId | null;
  }>;
  markBindingError(errorCode: string): Promise<void>;
  retrieveSessionReply(
    sessionId: SessionId,
    runId: SessionRunId,
  ): Promise<ChannelAgentReplyResult | null>;
}
