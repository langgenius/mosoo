import type { DriverEventInput } from "@mosoo/driver-protocol";

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

interface DriverEventBatchSummary {
  customNameCounts: Record<string, number>;
  messageContentChars: number;
  messageContentCount: number;
  rawSourceCounts: Record<string, number>;
  runFinishedCount: number;
  runStartedCount: number;
  toolCallArgsCount: number;
  toolCallEndCount: number;
  toolCallResultCount: number;
  toolCallStartCount: number;
  typeCounts: Record<string, number>;
}

function createDriverEventBatchSummary(): DriverEventBatchSummary {
  return {
    customNameCounts: {},
    messageContentChars: 0,
    messageContentCount: 0,
    rawSourceCounts: {},
    runFinishedCount: 0,
    runStartedCount: 0,
    toolCallArgsCount: 0,
    toolCallEndCount: 0,
    toolCallResultCount: 0,
    toolCallStartCount: 0,
    typeCounts: {},
  };
}

function addDriverEventToSummary(summary: DriverEventBatchSummary, event: DriverEventInput): void {
  incrementCount(summary.typeCounts, event.kind);

  if (event.kind === "run.started") {
    summary.runStartedCount += 1;
    return;
  }

  if (event.kind === "run.completed" || event.kind === "run.cancelled") {
    summary.runFinishedCount += 1;
    return;
  }

  if (event.kind === "item.started") {
    summary.toolCallStartCount += 1;
    return;
  }

  if (event.kind === "item.completed") {
    summary.toolCallEndCount += 1;
    return;
  }

  if (event.kind === "message.delta") {
    const payload = isUnknownRecord(event.payload) ? event.payload : {};
    const delta = typeof payload["contentDelta"] === "string" ? payload["contentDelta"] : "";
    summary.messageContentCount += 1;
    summary.messageContentChars += delta.length;
    return;
  }

  if (event.kind === "tool.call.updated") {
    const payload = isUnknownRecord(event.payload) ? event.payload : {};
    if (typeof payload["rawInput"] === "string") {
      summary.toolCallArgsCount += 1;
    }
    if (typeof payload["rawOutput"] === "string" || typeof payload["content"] === "string") {
      summary.toolCallResultCount += 1;
    }
  }
}

export function summarizeDriverEventBatch(events: DriverEventInput[]): Record<string, unknown> {
  const summary = createDriverEventBatchSummary();

  for (const event of events) {
    addDriverEventToSummary(summary, event);
  }

  return {
    customNameCounts: summary.customNameCounts,
    eventCount: events.length,
    messageContentChars: summary.messageContentChars,
    messageContentCount: summary.messageContentCount,
    rawSourceCounts: summary.rawSourceCounts,
    runFinishedCount: summary.runFinishedCount,
    runStartedCount: summary.runStartedCount,
    toolCallArgsCount: summary.toolCallArgsCount,
    toolCallEndCount: summary.toolCallEndCount,
    toolCallResultCount: summary.toolCallResultCount,
    toolCallStartCount: summary.toolCallStartCount,
    typeCounts: summary.typeCounts,
  };
}
