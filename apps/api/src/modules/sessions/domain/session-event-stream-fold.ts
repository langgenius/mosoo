import type { RuntimeEventId, SessionRunId } from "@mosoo/id";

// Streamed text events (message.delta / thought.delta) are persisted one row
// per fragment so every accepted source identity stays durable (#274). Reading
// them back verbatim renders each fragment as its own timeline entry, so read
// paths fold each identified stream into one row before projecting process
// events. message.added starts an authoritative snapshot, and later deltas
// append to it.

export interface StreamFoldableSessionEventRow {
  content_text: string;
  ended_at: number;
  event_type: string;
  id: RuntimeEventId;
  occurred_at: number;
  process_type: string;
  run_id: SessionRunId | null;
  seq: number;
  stream_id: string | null;
  tokens: number | null;
}

type StreamRowPhase = "added" | "completed" | "delta" | "started";

const MESSAGE_STREAM_AUTHORITY_RESET_EVENT_TYPES = [
  "message.cancelled",
  "message.failed",
  "message.started",
] as const;

export const MESSAGE_STREAM_AUTHORITY_BOUNDARY_EVENT_TYPES = [
  "message.added",
  ...MESSAGE_STREAM_AUTHORITY_RESET_EVENT_TYPES,
] as const;

export const MESSAGE_STREAM_EVENT_TYPES = [
  ...MESSAGE_STREAM_AUTHORITY_BOUNDARY_EVENT_TYPES,
  "message.completed",
  "message.delta",
] as const;

const messageStreamAuthorityResetEventTypes: ReadonlySet<string> = new Set(
  MESSAGE_STREAM_AUTHORITY_RESET_EVENT_TYPES,
);

interface StreamRowClassification {
  phase: StreamRowPhase;
  placeholder: string;
}

const MESSAGE_PLACEHOLDER = "Message updated.";
const THOUGHT_PLACEHOLDER = "Agent thinking updated.";

const streamRowClassifications: Readonly<Record<string, StreamRowClassification>> = {
  "message.added": { phase: "added", placeholder: MESSAGE_PLACEHOLDER },
  "message.cancelled": { phase: "completed", placeholder: MESSAGE_PLACEHOLDER },
  "message.completed": { phase: "completed", placeholder: MESSAGE_PLACEHOLDER },
  "message.delta": { phase: "delta", placeholder: MESSAGE_PLACEHOLDER },
  "message.failed": { phase: "completed", placeholder: MESSAGE_PLACEHOLDER },
  "message.started": { phase: "started", placeholder: MESSAGE_PLACEHOLDER },
  "thought.cancelled": { phase: "completed", placeholder: THOUGHT_PLACEHOLDER },
  "thought.completed": { phase: "completed", placeholder: THOUGHT_PLACEHOLDER },
  "thought.delta": { phase: "delta", placeholder: THOUGHT_PLACEHOLDER },
  "thought.started": { phase: "started", placeholder: THOUGHT_PLACEHOLDER },
};

const terminalRunEventTypes = new Set(["run.cancelled", "run.completed", "run.failed"]);

export interface MessageStreamTextFragment {
  kind: "append" | "reset";
  text: string;
}

export function getMessageStreamTextFragment(
  row: StreamFoldableSessionEventRow,
): MessageStreamTextFragment | null {
  const classification = streamRowClassifications[row.event_type];

  if (
    classification === undefined ||
    !row.event_type.startsWith("message.") ||
    (classification.phase !== "added" && classification.phase !== "delta")
  ) {
    return null;
  }

  return {
    kind: classification.phase === "added" ? "reset" : "append",
    text: row.content_text,
  };
}

interface StreamGroup<R extends StreamFoldableSessionEventRow> {
  contentText: string;
  firstRow: R;
  latestRow: R;
  outputIndex: number | null;
  placeholder: string;
  representative: R | null;
  runId: SessionRunId | null;
  terminal: boolean;
}

interface ScannedStreamState {
  leftBoundarySeen: boolean;
  runId: SessionRunId | null;
}

function createStreamGroup<R extends StreamFoldableSessionEventRow>(
  row: R,
  classification: StreamRowClassification,
): StreamGroup<R> {
  return {
    contentText: "",
    firstRow: row,
    latestRow: row,
    outputIndex: null,
    placeholder: classification.placeholder,
    representative: null,
    runId: row.run_id,
    terminal: false,
  };
}

export function getSessionEventStreamKey(row: StreamFoldableSessionEventRow): string | null {
  if (streamRowClassifications[row.event_type] === undefined) {
    return null;
  }

  if (row.stream_id === null) {
    throw new Error(`Streamed session event ${row.id} has no stream identity.`);
  }

  return JSON.stringify([row.run_id, row.process_type, row.stream_id]);
}

// Reverse window scans must cross a stream's left boundary before treating
// its folded content and first sequence as complete. Migration identities
// that equal their row ID are deliberately row-scoped and already complete.
export function findLeftIncompleteSessionEventStreamKeys(
  rows: readonly StreamFoldableSessionEventRow[],
): Set<string> {
  const runStarts = new Set<SessionRunId>();
  const streams = new Map<string, ScannedStreamState>();

  for (const row of rows) {
    if (row.event_type === "run.started" && row.run_id !== null) {
      runStarts.add(row.run_id);
    }

    const key = getSessionEventStreamKey(row);

    if (key === null) {
      continue;
    }

    const stream = streams.get(key) ?? {
      leftBoundarySeen: false,
      runId: row.run_id,
    };
    stream.leftBoundarySeen ||=
      row.event_type === "message.added" ||
      row.event_type === "message.started" ||
      row.event_type === "thought.started" ||
      row.stream_id === row.id;
    streams.set(key, stream);
  }

  return new Set(
    [...streams]
      .filter(
        ([, stream]) =>
          !stream.leftBoundarySeen && (stream.runId === null || !runStarts.has(stream.runId)),
      )
      .map(([key]) => key),
  );
}

export function excludeSessionEventStreams<R extends StreamFoldableSessionEventRow>(
  rows: readonly R[],
  excludedKeys: ReadonlySet<string>,
): R[] {
  return rows.filter((row) => {
    const key = getSessionEventStreamKey(row);
    return key === null || !excludedKeys.has(key);
  });
}

function mergeStreamRow<R extends StreamFoldableSessionEventRow>(
  group: StreamGroup<R>,
  row: R,
  classification: StreamRowClassification,
): void {
  group.latestRow = row;
  group.contentText = mergeStreamText(
    group.contentText,
    row.content_text,
    classification,
    group.placeholder,
  );

  if (classification.phase === "added") {
    if (!group.terminal) {
      group.representative = row;
    }
  } else if (classification.phase === "completed") {
    if (group.outputIndex === null) {
      group.representative = row;
    }
    group.terminal = true;
  }
}

function mergeStreamText(
  currentText: string,
  rowText: string,
  classification: StreamRowClassification,
  placeholder: string,
): string {
  const text =
    classification.phase === "added" || classification.phase === "delta"
      ? rowText
      : rowText === placeholder
        ? ""
        : rowText;

  if (classification.phase === "added") {
    return text;
  }
  if (classification.phase === "delta") {
    return currentText + text;
  }
  if (classification.phase === "completed") {
    return currentText || text;
  }
  return currentText;
}

/**
 * Resolves one already-ordered assistant message stream only when its latest
 * lifecycle is sealed by message.completed. A later start, delta, or
 * authoritative snapshot opens the stream again, so an old terminal receipt
 * cannot make an incomplete replacement look final.
 */
interface AuthoritativeMessageStream {
  sealed: boolean;
  text: string;
}

export interface MessageStreamLifecycle {
  authoritative: boolean;
  sealed: boolean;
}

export interface MessageStreamReducerState
  extends AuthoritativeMessageStream, MessageStreamLifecycle {}

export function createMessageStreamLifecycle(): MessageStreamLifecycle {
  return { authoritative: false, sealed: false };
}

export function reduceMessageStreamLifecycle(
  state: MessageStreamLifecycle,
  eventType: string,
): MessageStreamLifecycle {
  if (eventType === "message.added") {
    return { authoritative: true, sealed: false };
  }
  if (messageStreamAuthorityResetEventTypes.has(eventType)) {
    return { authoritative: false, sealed: false };
  }
  if (eventType === "message.completed") {
    return { authoritative: state.authoritative, sealed: state.authoritative };
  }
  if (eventType === "message.delta") {
    return { authoritative: state.authoritative, sealed: false };
  }
  return state;
}

export function createMessageStreamReducerState(): MessageStreamReducerState {
  return { ...createMessageStreamLifecycle(), text: "" };
}

export function reduceMessageStreamRow(
  state: MessageStreamReducerState,
  row: StreamFoldableSessionEventRow,
  options?: { maxTextLength: number },
): void {
  const classification = streamRowClassifications[row.event_type];

  if (classification === undefined || !row.event_type.startsWith("message.")) {
    return;
  }

  state.text = mergeStreamText(state.text, row.content_text, classification, MESSAGE_PLACEHOLDER);
  if (options !== undefined && state.text.length > options.maxTextLength) {
    state.text = state.text.slice(0, options.maxTextLength);
  }
  const lifecycle = reduceMessageStreamLifecycle(state, row.event_type);
  state.authoritative = lifecycle.authoritative;
  state.sealed = lifecycle.sealed;
}

function resolveAuthoritativeMessageStream(
  rows: readonly StreamFoldableSessionEventRow[],
): AuthoritativeMessageStream | null {
  const state = createMessageStreamReducerState();

  for (const row of rows) {
    reduceMessageStreamRow(state, row);
  }

  return state.authoritative ? { sealed: state.sealed, text: state.text } : null;
}

export function resolveSealedMessageStream(
  rows: readonly StreamFoldableSessionEventRow[],
): { text: string } | null {
  const stream = resolveAuthoritativeMessageStream(rows);
  return stream?.sealed === true ? { text: stream.text } : null;
}

function createFoldedStreamRow<R extends StreamFoldableSessionEventRow>(
  group: StreamGroup<R>,
  keepEmpty: boolean,
): R | null {
  if (!keepEmpty && group.contentText.length === 0) {
    return null;
  }

  const lastRow = group.representative ?? group.latestRow;

  return {
    ...lastRow,
    content_text: group.contentText,
    occurred_at: group.firstRow.occurred_at,
    seq: group.firstRow.seq,
  };
}

function emitStreamGroup<R extends StreamFoldableSessionEventRow>(
  output: R[],
  group: StreamGroup<R>,
  keepEmpty: boolean,
): void {
  const folded = createFoldedStreamRow(group, keepEmpty);

  if (folded === null) {
    return;
  }

  if (group.outputIndex === null) {
    group.outputIndex = output.length;
    output.push(folded);
  } else {
    output[group.outputIndex] = folded;
  }
}

export function foldStreamedSessionEventRows<R extends StreamFoldableSessionEventRow>(
  rows: readonly R[],
): R[] {
  const output: R[] = [];
  const groups = new Map<string, StreamGroup<R>>();

  for (const row of rows) {
    const classification = streamRowClassifications[row.event_type];

    if (classification === undefined) {
      // A terminal run receipt flushes the run's interrupted streams, exactly
      // like the pre-persistence compactor did, so a failed run still shows
      // the text it managed to stream.
      if (terminalRunEventTypes.has(row.event_type)) {
        for (const group of groups.values()) {
          if (group.runId === row.run_id && group.outputIndex === null) {
            emitStreamGroup(output, group, false);
          }
        }
      }

      output.push(row);
      continue;
    }

    const key = getSessionEventStreamKey(row);

    if (key === null) {
      throw new Error(`Streamed session event ${row.id} has no stream classification.`);
    }
    const group = groups.get(key) ?? createStreamGroup(row, classification);
    groups.set(key, group);
    mergeStreamRow(group, row, classification);

    if (classification.phase === "completed" || group.outputIndex !== null) {
      emitStreamGroup(output, group, true);
    }
  }

  for (const group of groups.values()) {
    if (group.outputIndex === null) {
      emitStreamGroup(output, group, group.representative !== null);
    }
  }

  return output.toSorted((a, b) => a.seq - b.seq);
}
