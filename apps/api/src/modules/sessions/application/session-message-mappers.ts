import type { SessionMessage } from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { PlatformId, SessionMessageId } from "@mosoo/id";

import { toIsoString } from "../../../time";
import {
  sanitizeAssistantMessageSegments,
  sanitizeProviderPrivateMarkup,
} from "../domain/provider-private-markup";
import { parseStoredSessionMessageProjection } from "../domain/session-message-projection-parser";

export interface SessionMessageRow {
  content_text: string;
  created_at: number;
  created_by_account_id: PlatformId;
  id: SessionMessageId;
  plan_json: string | null;
  role: "assistant" | "user";
  segments_json: string | null;
}

export function toSessionMessage(row: SessionMessageRow): SessionMessage {
  const { plan, segments } = parseStoredSessionMessageProjection({
    planJson: row.plan_json,
    segmentsJson: row.segments_json,
  });

  return {
    content:
      row.role === "assistant"
        ? sanitizeProviderPrivateMarkup(row.content_text).text
        : row.content_text,
    createdAt: toIsoString(row.created_at),
    createdBy: parsePlatformId(row.created_by_account_id, "Session message creator ID"),
    id: parsePlatformId<SessionMessageId>(row.id, "Session message ID"),
    plan,
    role: row.role,
    segments: row.role === "assistant" ? sanitizeAssistantMessageSegments(segments) : segments,
  };
}
