import { sessionMessagesTable } from "@mosoo/db";
import type { SessionId, SessionMessageId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import { parseStoredSessionMessageProjection } from "../domain/session-message-projection-parser";
import type { SessionLiveStateMessage } from "./session-live-state.types";

export interface StoredSessionMessageRow {
  content_text: string;
  created_at: number;
  id: SessionMessageId;
  plan_json: string | null;
  role: "assistant" | "user";
  segments_json: string | null;
  seq: number;
}

function compareStoredSessionMessageRows(
  left: StoredSessionMessageRow,
  right: StoredSessionMessageRow,
): number {
  return left.seq - right.seq;
}

function toLiveStateMessage(row: StoredSessionMessageRow): SessionLiveStateMessage {
  const { plan, segments } = parseStoredSessionMessageProjection({
    planJson: row.plan_json,
    segmentsJson: row.segments_json,
  });

  return {
    content: row.content_text,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    plan,
    role: row.role,
    segments,
  };
}

function storedSessionMessageRowsToLiveMessages(
  rows: StoredSessionMessageRow[],
): SessionLiveStateMessage[] {
  return [...rows].toSorted(compareStoredSessionMessageRows).map((row) => toLiveStateMessage(row));
}

export async function loadStoredSessionMessages(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionLiveStateMessage[]> {
  const results = await getAppDatabase(database)
    .select({
      content_text: sessionMessagesTable.contentText,
      created_at: sessionMessagesTable.createdAt,
      id: sessionMessagesTable.id,
      plan_json: sessionMessagesTable.planJson,
      role: sessionMessagesTable.role,
      segments_json: sessionMessagesTable.segmentsJson,
      seq: sessionMessagesTable.seq,
    })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, sessionId))
    .orderBy(asc(sessionMessagesTable.seq))
    .all();

  return storedSessionMessageRowsToLiveMessages(results);
}
