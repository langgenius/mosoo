import type { RuntimeEventId, SessionRunId } from "@mosoo/id";

// Streamed text events (message.delta / thought.delta) are persisted one row
// per fragment so every accepted source identity stays durable (#274). Reading
// them back verbatim renders each fragment as its own timeline entry, so read
// paths fold a fragment stream into a single row before projecting process
// events. The merge rules mirror the pre-persistence compactor
// (runtime-event-compaction.ts): deltas append, snapshots prefer the longer
// prefix-matching text.
//
// Rows carry no message identity, so a stream whose driver-side identity
// fractured (a dropped message_start splits one reply across several
// started/delta groups, YEF-884) still folds into several fragment rows, and
// the trailing message.added snapshot lands after its stream already closed.
// To heal both shapes, closed fragment rows are kept as supersede candidates:
// a snapshot whose text prefix-matches the concatenated fragments replaces
// them with a single row instead of rendering a duplicate.

export interface StreamFoldableSessionEventRow {
  content_text: string;
  ended_at: number;
  event_type: string;
  id: RuntimeEventId;
  occurred_at: number;
  process_type: string;
  run_id: SessionRunId | null;
  seq: number;
  tokens: number | null;
}

export interface FoldedStreamedSessionEventRows<R> {
  /**
   * Raw rows of streams that have not seen their closing event yet, in seq
   * order. Only populated when `flushOpenStreams` is false; callers carry them
   * into the next fold so a stream spanning reads still emits exactly once.
   */
  openStreamRows: R[];
  rows: R[];
}

type StreamRowPhase = "added" | "completed" | "delta" | "started";

interface StreamRowClassification {
  phase: StreamRowPhase;
  placeholder: string;
}

const MESSAGE_PLACEHOLDER = "Message updated.";
const THOUGHT_PLACEHOLDER = "Agent thinking updated.";

const streamRowClassifications: Readonly<Record<string, StreamRowClassification>> = {
  "message.added": { phase: "added", placeholder: MESSAGE_PLACEHOLDER },
  "message.completed": { phase: "completed", placeholder: MESSAGE_PLACEHOLDER },
  "message.delta": { phase: "delta", placeholder: MESSAGE_PLACEHOLDER },
  "message.started": { phase: "started", placeholder: MESSAGE_PLACEHOLDER },
  "thought.completed": { phase: "completed", placeholder: THOUGHT_PLACEHOLDER },
  "thought.delta": { phase: "delta", placeholder: THOUGHT_PLACEHOLDER },
  "thought.started": { phase: "started", placeholder: THOUGHT_PLACEHOLDER },
};

const terminalRunEventTypes = new Set(["run.cancelled", "run.completed", "run.failed"]);

interface OpenStreamGroup<R extends StreamFoldableSessionEventRow> {
  contentText: string;
  placeholder: string;
  rows: R[];
  runId: SessionRunId | null;
}

interface ClosedFragmentSegment {
  content: string;
  outputIndex: number;
}

function appendStreamText(current: string, next: string): string {
  if (next.length === 0) {
    return current;
  }

  return current.length === 0 ? next : `${current}${next}`;
}

function mergeSnapshotText(current: string, next: string): string {
  if (next.length === 0) {
    return current;
  }

  if (current.length === 0) {
    return next;
  }

  if (next.length > current.length && next.startsWith(current)) {
    return next;
  }

  if (current.length >= next.length && current.startsWith(next)) {
    return current;
  }

  return `${current}${next}`;
}

function isSnapshotOfFragments(fragments: string, snapshot: string): boolean {
  if (fragments.length === 0 || snapshot.length === 0) {
    return false;
  }

  return snapshot.startsWith(fragments) || fragments.startsWith(snapshot);
}

function createOpenStreamGroup<R extends StreamFoldableSessionEventRow>(
  row: R,
  classification: StreamRowClassification,
): OpenStreamGroup<R> {
  return {
    contentText: "",
    placeholder: classification.placeholder,
    rows: [],
    runId: row.run_id,
  };
}

function mergeStreamRow<R extends StreamFoldableSessionEventRow>(
  group: OpenStreamGroup<R>,
  row: R,
  classification: StreamRowClassification,
): void {
  group.rows.push(row);

  // Fragments that carried no text are persisted with the process-draft
  // placeholder; they mark stream boundaries and must not leak into the text.
  if (row.content_text === group.placeholder) {
    return;
  }

  group.contentText =
    classification.phase === "delta"
      ? appendStreamText(group.contentText, row.content_text)
      : mergeSnapshotText(group.contentText, row.content_text);
}

function createFoldedStreamRow<R extends StreamFoldableSessionEventRow>(
  group: OpenStreamGroup<R>,
): R | null {
  const firstRow = group.rows[0];
  const lastRow = group.rows[group.rows.length - 1];

  if (firstRow === undefined || lastRow === undefined || group.contentText.length === 0) {
    return null;
  }

  return {
    ...lastRow,
    content_text: group.contentText,
    occurred_at: firstRow.occurred_at,
    seq: firstRow.seq,
  };
}

export function foldStreamedSessionEventRows<R extends StreamFoldableSessionEventRow>(
  rows: readonly R[],
  options: { flushOpenStreams: boolean },
): FoldedStreamedSessionEventRows<R> {
  const output: (R | null)[] = [];
  const openGroups = new Map<string, OpenStreamGroup<R>>();
  const fragmentSegments = new Map<string, ClosedFragmentSegment[]>();

  function closeGroupAsFragment(key: string, group: OpenStreamGroup<R>): void {
    const folded = createFoldedStreamRow(group);

    if (folded === null) {
      return;
    }

    output.push(folded);
    const segments = fragmentSegments.get(key) ?? [];
    segments.push({ content: folded.content_text, outputIndex: output.length - 1 });
    fragmentSegments.set(key, segments);
  }

  // A snapshot row is the authoritative text of the message it closes. When
  // its text extends (or repeats) the fragment rows already emitted for the
  // same stream key, those fragments were partial views of this snapshot:
  // collapse them into one row at the first fragment's timeline position.
  function closeGroupWithSnapshot(key: string, folded: R | null): void {
    if (folded === null) {
      return;
    }

    const segments = fragmentSegments.get(key) ?? [];
    fragmentSegments.delete(key);
    const fragments = segments.map((segment) => segment.content).join("");

    if (!isSnapshotOfFragments(fragments, folded.content_text)) {
      output.push(folded);
      return;
    }

    const firstSegment = segments[0];
    const anchorRow = firstSegment === undefined ? null : output[firstSegment.outputIndex];

    if (firstSegment === undefined || anchorRow === null || anchorRow === undefined) {
      output.push(folded);
      return;
    }

    for (const segment of segments) {
      output[segment.outputIndex] = null;
    }

    output[firstSegment.outputIndex] = {
      ...folded,
      content_text:
        folded.content_text.length >= fragments.length ? folded.content_text : fragments,
      occurred_at: anchorRow.occurred_at,
      seq: anchorRow.seq,
    };
  }

  for (const row of rows) {
    const classification = streamRowClassifications[row.event_type];

    if (classification === undefined) {
      // A terminal run receipt flushes the run's interrupted streams, exactly
      // like the pre-persistence compactor did, so a failed run still shows
      // the text it managed to stream.
      if (terminalRunEventTypes.has(row.event_type)) {
        for (const [key, group] of openGroups) {
          if (group.runId === row.run_id) {
            openGroups.delete(key);
            closeGroupAsFragment(key, group);
          }
        }
      }

      output.push(row);
      continue;
    }

    const key = `${row.run_id ?? ""}:${row.process_type}`;
    const existing = openGroups.get(key) ?? null;

    if (classification.phase === "started") {
      if (existing !== null) {
        openGroups.delete(key);
        closeGroupAsFragment(key, existing);
      }

      const group = createOpenStreamGroup(row, classification);
      mergeStreamRow(group, row, classification);
      openGroups.set(key, group);
      continue;
    }

    if (classification.phase === "added" && existing === null) {
      // A snapshot with no open stream is either a complete standalone
      // message (legacy compacted rows and non-streamed messages) or the
      // authoritative copy of fragments that already closed; the supersede
      // check keeps the first case verbatim.
      closeGroupWithSnapshot(key, row.content_text === classification.placeholder ? null : row);

      if (row.content_text === classification.placeholder) {
        output.push(row);
      }
      continue;
    }

    const group = existing ?? createOpenStreamGroup(row, classification);
    mergeStreamRow(group, row, classification);

    if (classification.phase === "added") {
      openGroups.delete(key);
      closeGroupWithSnapshot(key, createFoldedStreamRow(group));
    } else if (classification.phase === "completed") {
      openGroups.delete(key);
      closeGroupAsFragment(key, group);
    } else if (existing === null) {
      openGroups.set(key, group);
    }
  }

  if (options.flushOpenStreams) {
    for (const [key, group] of openGroups) {
      closeGroupAsFragment(key, group);
    }

    return { openStreamRows: [], rows: output.filter((row): row is R => row !== null) };
  }

  return {
    openStreamRows: [...openGroups.values()]
      .flatMap((group) => group.rows)
      .toSorted((a, b) => a.seq - b.seq),
    rows: output.filter((row): row is R => row !== null),
  };
}
