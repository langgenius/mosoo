import { parsePlatformId } from "@mosoo/id";
import type { PublicThreadId, SessionId } from "@mosoo/id";

export function toBackingSessionId(threadId: PublicThreadId): SessionId {
  return parsePlatformId<SessionId>(threadId, "Session ID");
}

export function toPublicThreadId(sessionId: SessionId): PublicThreadId {
  return parsePlatformId<PublicThreadId>(sessionId, "Thread ID");
}
