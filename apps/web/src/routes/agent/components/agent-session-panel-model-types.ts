import type { SessionLiveState, SessionRunView } from "@mosoo/ag-ui-session";
import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { SessionSummary } from "@mosoo/contracts/session";

import type { SessionResourceMention } from "@/features/session-chat/session-resource-mentions";

export interface ComposerError {
  actionLabel?: string | null;
  message: string;
  retryable: boolean;
}

export interface SendOptions {
  sessionResourceMentions?: SessionResourceMention[];
  text: string;
}

export interface UseAgentSessionPanelModelInput {
  agentId: string;
  configurationChangedAt: string | null;
  projectId: string | null;
  readiness: AgentReadiness | null;
}

export interface AgentSessionPanelModel {
  activeSession: SessionSummary | null;
  activeSessionId: string | null;
  cancel: () => Promise<void>;
  composerError: ComposerError | null;
  configurationRefreshRequired: boolean;
  ensureActiveSession: () => Promise<string>;
  handleResetSession: () => Promise<void>;
  handleSend: (options: SendOptions) => Promise<boolean>;
  isConversationLoading: boolean;
  lifecycle: SessionLiveState["lifecycle"];
  messages: SessionLiveState["messages"];
  notifyComposerTyping: () => void;
  readiness: AgentReadiness | null;
  readinessBlockMessage: string | null;
  reconnecting: boolean;
  refreshSessions: () => Promise<void>;
  run: SessionRunView;
  sending: boolean;
  sessionLoadError: string | null;
  streaming: boolean;
}
