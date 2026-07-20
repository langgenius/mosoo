import type { AgentId, SessionId, SessionRunId } from "@mosoo/id";

export const CHANNEL_AGENT_FAILURE_TEXT = "mosoo is having trouble responding. Try again later.";

export function buildChannelSessionLink(input: {
  agentId: AgentId;
  sessionId: SessionId;
  sessionLinkBaseUrl: string | null;
}): string {
  const baseUrl = input.sessionLinkBaseUrl ?? "";
  const agentId = encodeURIComponent(input.agentId);
  const sessionId = encodeURIComponent(input.sessionId);

  return `${baseUrl}/agent/${agentId}?tab=consume&sessionId=${sessionId}`;
}

export function buildChannelWorkingText(input: {
  linkLabel?: string;
  sessionLink: string;
}): string {
  const target = input.linkLabel ? `<${input.sessionLink}|${input.linkLabel}>` : input.sessionLink;
  return `mosoo session created: ${target}. Agent is working...`;
}

export type ChannelAgentReplyResult =
  | {
      status: "completed";
      text: string | null;
    }
  | {
      status: "failed";
      text: string;
    }
  | {
      status: "timeout";
      text: string | null;
    };

export interface ChannelAgentReplyPollClient {
  retrieveSessionReply(
    sessionId: SessionId,
    runId: SessionRunId,
  ): Promise<ChannelAgentReplyResult | null>;
}
