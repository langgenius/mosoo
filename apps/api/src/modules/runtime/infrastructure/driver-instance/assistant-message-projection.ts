import { parsePlatformId } from "@mosoo/id";
import type { PlatformId, SessionId, SessionMessageId, SessionRunId } from "@mosoo/id";

export interface PreparedAssistantMessageProjection {
  contentText: string;
  createdByAccountId: PlatformId;
  id: SessionMessageId;
  planJson: string | null;
  projectionFormat: "event_stream_v3";
  segmentsJson: string | null;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}

export function prepareAssistantMessageProjection(input: {
  createdByAccountId: PlatformId;
  messageId: string;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}): PreparedAssistantMessageProjection {
  const messageId = parsePlatformId<SessionMessageId>(input.messageId, "assistant message id");
  return {
    // The authoritative aggregate lives in paginated session_event rows. This
    // row is only the transcript identity/order reference; materializing the
    // same unbounded body here would exceed D1's per-row limit.
    contentText: "",
    createdByAccountId: input.createdByAccountId,
    id: messageId,
    planJson: null,
    projectionFormat: "event_stream_v3",
    segmentsJson: null,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
  };
}

export function prepareToolCarrierProjection(input: {
  createdByAccountId: PlatformId;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}): PreparedAssistantMessageProjection {
  return prepareAssistantMessageProjection({
    createdByAccountId: input.createdByAccountId,
    messageId: input.sessionRunId,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
  });
}
