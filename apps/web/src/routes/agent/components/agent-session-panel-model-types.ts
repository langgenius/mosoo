import type { SessionLiveState, SessionRunView } from "@mosoo/ag-ui-session";
import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { SessionSummary, SessionType } from "@mosoo/contracts/session";
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";

import type { PermissionRequest } from "@/domains/runtime/use-session-stream";
import type { SessionResourceMention } from "@/features/session-chat/session-resource-mentions";

export interface ComposerError {
  actionLabel?: string | null;
  message: string;
  retryable: boolean;
}

export interface SendOptions {
  sessionResourceMentions?: SessionResourceMention[];
}

export type PermissionDecision = "allow_once" | "reject_once";

export interface UseAgentSessionPanelModelInput {
  agentId: string;
  configurationChangedAt: string | null;
  configurationRevisionKey: string | null;
  organizationId: string | null;
  appId: string | null;
  readiness: AgentReadiness | null;
  requireFreshConfiguration: boolean;
  sessionType: SessionType;
  waitForRuntimeReadyOnNewSession: boolean;
}

export interface AgentSessionPanelModel {
  activeSession: SessionSummary | null;
  activeSessionId: string | null;
  composerError: ComposerError | null;
  configurationRefreshRequired: boolean;
  ensureActiveSession: () => Promise<string>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleKeyDown: (event: KeyboardEvent, options?: SendOptions) => Promise<boolean>;
  handleResetSession: () => Promise<void>;
  handleSend: (options?: SendOptions) => Promise<boolean>;
  handleStartNewSession: () => Promise<void>;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isConversationLoading: boolean;
  lifecycle: SessionLiveState["lifecycle"];
  messages: SessionLiveState["messages"];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  permissionRequests: PermissionRequest[];
  readiness: AgentReadiness | null;
  readinessBlockMessage: string | null;
  reconnecting: boolean;
  resolvePermission: (request: PermissionRequest, decision: PermissionDecision) => Promise<void>;
  retryProviderCheck: () => Promise<void>;
  run: SessionRunView;
  sending: boolean;
  sessionCount: number;
  sessionLoadError: string | null;
  setInput: Dispatch<SetStateAction<string>>;
  streaming: boolean;
}
