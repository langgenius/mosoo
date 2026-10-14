import { MAX_THOUGHT_CONTENT_BYTES } from "@mosoo/agent-driver/runtime-events";
import { sessionEventsTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { readRuntimeEventMessageKey, readRuntimeEventThoughtUpdate } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { sessionEventThoughtColumns } from "../../../sessions/infrastructure/session-event-read.repository";

interface ThoughtState {
  bytes: number;
  closed: boolean;
  nextOffset: number;
}

export async function validateThoughtEvents(
  database: D1Database,
  input: { events: readonly RuntimeEventEnvelope[]; sessionId: SessionId },
): Promise<void> {
  const thoughtIds = [
    ...new Set(
      input.events.flatMap((event) =>
        event.kind === "thought.updated" ? [readRuntimeEventThoughtUpdate(event).thoughtId] : [],
      ),
    ),
  ];
  if (thoughtIds.length === 0) return;

  const { thought_id, thought_offset } = sessionEventThoughtColumns();
  const db = getAppDatabase(database);
  const summaries = await db
    .select({
      bytes: sql<number>`sum(CASE WHEN ${sessionEventsTable.eventType} = 'thought.updated'
        THEN length(CAST(json_quote(${sessionEventsTable.contentText}) AS BLOB)) - 2 ELSE 0 END)`,
      closed: sql<number>`max(CASE WHEN ${sessionEventsTable.eventType} IN
        ('thought.completed', 'thought.cancelled') THEN 1 ELSE 0 END)`,
      lastUpdateSeq: sql<number | null>`max(CASE WHEN ${sessionEventsTable.eventType} =
        'thought.updated' THEN ${sessionEventsTable.seq} END)`,
      thoughtId: thought_id,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        inArray(sessionEventsTable.eventType, [
          "thought.updated",
          "thought.completed",
          "thought.cancelled",
        ]),
        inArray(thought_id, thoughtIds),
      ),
    )
    .groupBy(thought_id)
    .all();
  const states = new Map<string, ThoughtState>();
  const lastUpdates = new Map<number, ThoughtState>();
  for (const summary of summaries) {
    if (summary.thoughtId === null) continue;
    const state = { bytes: summary.bytes, closed: summary.closed !== 0, nextOffset: 0 };
    states.set(summary.thoughtId, state);
    if (summary.lastUpdateSeq !== null) lastUpdates.set(summary.lastUpdateSeq, state);
  }

  const sequences = [...lastUpdates.keys()];
  // Only each thought's last chunk is needed for its UTF-16 offset; cap each read at 2 MiB.
  for (let start = 0; start < sequences.length; start += 4) {
    const rows = await db
      .select({
        content: sessionEventsTable.contentText,
        offset: thought_offset,
        seq: sessionEventsTable.seq,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          inArray(sessionEventsTable.seq, sequences.slice(start, start + 4)),
        ),
      )
      .all();
    for (const row of rows) {
      if (row.offset === null) throw new Error("Persisted thought offset is missing.");
      lastUpdates.get(row.seq)!.nextOffset = row.offset + row.content.length;
    }
    if (rows.length !== sequences.slice(start, start + 4).length) {
      throw new Error("Persisted thought content changed during validation.");
    }
  }

  for (const event of input.events) {
    if (!event.kind.startsWith("thought.")) continue;
    const thoughtId = readRuntimeEventMessageKey(event)!;
    const state = states.get(thoughtId) ?? { bytes: 0, closed: false, nextOffset: 0 };
    states.set(thoughtId, state);
    if (event.kind === "thought.updated") {
      const update = readRuntimeEventThoughtUpdate(event);
      if (state.closed || update.offset !== state.nextOffset) {
        throw new Error("Reasoning snapshot chunks must be contiguous and immutable.");
      }
      state.bytes += new TextEncoder().encode(JSON.stringify(update.content)).byteLength - 2;
      if (state.bytes > MAX_THOUGHT_CONTENT_BYTES) {
        throw new Error("Reasoning snapshot exceeds the content byte limit.");
      }
      state.nextOffset += update.content.length;
    } else if (event.kind === "thought.completed" || event.kind === "thought.cancelled") {
      state.closed = true;
    }
  }
}
