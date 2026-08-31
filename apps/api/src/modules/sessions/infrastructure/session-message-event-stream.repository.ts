import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
} from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  createMessageStreamLifecycle,
  createMessageStreamReducerState,
  MESSAGE_STREAM_EVENT_TYPES,
  reduceMessageStreamLifecycle,
  reduceMessageStreamRow,
} from "../domain/session-event-stream-fold";
import type { StreamFoldableSessionEventRow } from "../domain/session-event-stream-fold";

const SESSION_MESSAGE_EVENT_PAGE_SIZE = 1_000;
const SESSION_MESSAGE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(MESSAGE_STREAM_EVENT_TYPES);

export interface SessionMessageEventStreamCursor {
  endSeq: number;
  finish: boolean;
  outputOffset: number;
  startSeq: number;
}

export interface SessionMessageEventStreamIdentity {
  processType: SessionProcessEvent["type"];
  runId: SessionRunId | null;
  sessionId: SessionId;
  streamId: string;
}

export interface SessionMessageEventRow extends StreamFoldableSessionEventRow {
  process_status: SessionProcessEvent["status"];
  process_type: SessionProcessEvent["type"];
}

async function assertExactMessageStreamIdentity(
  database: D1Database,
  input: SessionMessageEventStreamIdentity & { endSeq?: number },
): Promise<void> {
  const conflictingRun =
    input.runId === null
      ? isNotNull(sessionEventsTable.runId)
      : or(isNull(sessionEventsTable.runId), ne(sessionEventsTable.runId, input.runId));
  const collision = await getAppDatabase(database)
    .select({ id: sessionEventsTable.id })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        eq(sessionEventsTable.streamId, input.streamId),
        inArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES]),
        input.endSeq === undefined ? undefined : lte(sessionEventsTable.seq, input.endSeq),
        or(ne(sessionEventsTable.processType, input.processType), conflictingRun),
      ),
    )
    .limit(1)
    .get();

  if (collision !== undefined) {
    throw new Error(`Session message stream ${input.streamId} has conflicting identity rows.`);
  }
}

export async function* iteratePublicSessionMessageEventRows(
  database: D1Database,
  input: SessionMessageEventStreamIdentity & { cursor: SessionMessageEventStreamCursor },
): AsyncGenerator<SessionMessageEventRow> {
  let afterSeq: number | null = null;
  await assertExactMessageStreamIdentity(database, { ...input, endSeq: input.cursor.endSeq });
  const streamScope = [
    eq(sessionEventsTable.sessionId, input.sessionId),
    eq(sessionEventsTable.streamId, input.streamId),
    eq(sessionEventsTable.processType, input.processType),
    lte(sessionEventsTable.seq, input.cursor.endSeq),
    input.runId === null
      ? isNull(sessionEventsTable.runId)
      : eq(sessionEventsTable.runId, input.runId),
  ];
  const invalidRow = await getAppDatabase(database)
    .select({
      eventType: sessionEventsTable.eventType,
      visibility: sessionEventsTable.visibility,
    })
    .from(sessionEventsTable)
    .where(
      and(
        ...streamScope,
        or(
          ne(sessionEventsTable.visibility, "all_consumers"),
          notInArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES]),
        ),
      ),
    )
    .limit(1)
    .get();
  if (invalidRow?.visibility !== undefined) {
    throw new Error(
      invalidRow.visibility === "all_consumers"
        ? `Session message stream ${input.streamId} has unsupported event ${invalidRow.eventType}.`
        : `Session message stream ${input.streamId} has mixed visibility.`,
    );
  }

  for (;;) {
    const filters = [
      ...streamScope,
      eq(sessionEventsTable.visibility, "all_consumers"),
      gte(sessionEventsTable.seq, input.cursor.startSeq),
    ];

    if (afterSeq !== null) {
      filters.push(gt(sessionEventsTable.seq, afterSeq));
    }

    const page = await getAppDatabase(database)
      .select({
        content_text: sessionEventsTable.contentText,
        ended_at: sessionEventsTable.endedAt,
        event_type: sessionEventsTable.eventType,
        id: sessionEventsTable.id,
        occurred_at: sessionEventsTable.occurredAt,
        process_status: sessionEventsTable.processStatus,
        process_type: sessionEventsTable.processType,
        run_id: sessionEventsTable.runId,
        seq: sessionEventsTable.seq,
        stream_id: sessionEventsTable.streamId,
        tokens: sessionEventsTable.tokens,
      })
      .from(sessionEventsTable)
      .where(and(...filters))
      .orderBy(asc(sessionEventsTable.seq))
      .limit(SESSION_MESSAGE_EVENT_PAGE_SIZE)
      .all();

    for (const row of page) {
      if (!SESSION_MESSAGE_EVENT_TYPE_SET.has(row.event_type)) {
        throw new Error(
          `Session message stream ${input.streamId} has unsupported event ${row.event_type}.`,
        );
      }
      yield row;
    }

    if (page.length < SESSION_MESSAGE_EVENT_PAGE_SIZE) {
      return;
    }

    afterSeq = page[page.length - 1]?.seq ?? afterSeq;
  }
}

export async function readSealedPublicSessionMessage(
  database: D1Database,
  input: SessionMessageEventStreamIdentity & { endSeq?: number },
): Promise<{ text: string } | null> {
  const scope = [
    eq(sessionEventsTable.sessionId, input.sessionId),
    eq(sessionEventsTable.streamId, input.streamId),
    eq(sessionEventsTable.processType, input.processType),
    input.runId === null
      ? isNull(sessionEventsTable.runId)
      : eq(sessionEventsTable.runId, input.runId),
  ];
  const endSeq =
    input.endSeq ??
    (
      await getAppDatabase(database)
        .select({ seq: sessionEventsTable.seq })
        .from(sessionEventsTable)
        .where(and(...scope))
        .orderBy(desc(sessionEventsTable.seq))
        .limit(1)
        .get()
    )?.seq;
  if (endSeq === undefined) {
    return null;
  }
  const state = createMessageStreamReducerState();

  for await (const row of iteratePublicSessionMessageEventRows(database, {
    ...input,
    cursor: {
      endSeq,
      finish: true,
      outputOffset: 0,
      startSeq: 0,
    },
  })) {
    reduceMessageStreamRow(state, row);
  }

  return state.authoritative && state.sealed ? { text: state.text } : null;
}

export interface PublicSessionMessageStreamSealState {
  authoritative: boolean;
  sealed: boolean;
}

export async function readPublicSessionMessageStreamSealState(
  database: D1Database,
  input: SessionMessageEventStreamIdentity,
): Promise<PublicSessionMessageStreamSealState> {
  await assertExactMessageStreamIdentity(database, input);
  const scope = [
    eq(sessionEventsTable.sessionId, input.sessionId),
    eq(sessionEventsTable.streamId, input.streamId),
    eq(sessionEventsTable.processType, input.processType),
    input.runId === null
      ? isNull(sessionEventsTable.runId)
      : eq(sessionEventsTable.runId, input.runId),
  ];
  const endSeq = (
    await getAppDatabase(database)
      .select({ seq: sessionEventsTable.seq })
      .from(sessionEventsTable)
      .where(and(...scope))
      .orderBy(desc(sessionEventsTable.seq))
      .limit(1)
      .get()
  )?.seq;
  if (endSeq === undefined) {
    return { authoritative: false, sealed: false };
  }

  const invalidRow = await getAppDatabase(database)
    .select({
      eventType: sessionEventsTable.eventType,
      visibility: sessionEventsTable.visibility,
    })
    .from(sessionEventsTable)
    .where(
      and(
        ...scope,
        lte(sessionEventsTable.seq, endSeq),
        or(
          ne(sessionEventsTable.visibility, "all_consumers"),
          notInArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES]),
        ),
      ),
    )
    .limit(1)
    .get();
  if (invalidRow?.visibility !== undefined) {
    throw new Error(
      invalidRow.visibility === "all_consumers"
        ? `Session message stream ${input.streamId} has unsupported event ${invalidRow.eventType}.`
        : `Session message stream ${input.streamId} has mixed visibility.`,
    );
  }

  let afterSeq: number | null = null;
  let state = createMessageStreamLifecycle();
  for (;;) {
    const page = await getAppDatabase(database)
      .select({ eventType: sessionEventsTable.eventType, seq: sessionEventsTable.seq })
      .from(sessionEventsTable)
      .where(
        and(
          ...scope,
          eq(sessionEventsTable.visibility, "all_consumers"),
          lte(sessionEventsTable.seq, endSeq),
          afterSeq === null ? undefined : gt(sessionEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .limit(SESSION_MESSAGE_EVENT_PAGE_SIZE)
      .all();

    for (const row of page) {
      state = reduceMessageStreamLifecycle(state, row.eventType);
    }
    if (page.length < SESSION_MESSAGE_EVENT_PAGE_SIZE) {
      return state;
    }
    afterSeq = page[page.length - 1]?.seq ?? afterSeq;
  }
}

export async function isSealedPublicSessionMessageStream(
  database: D1Database,
  input: SessionMessageEventStreamIdentity,
): Promise<boolean> {
  return (await readPublicSessionMessageStreamSealState(database, input)).sealed;
}
