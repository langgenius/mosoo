import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import type { DriverEventReceipt } from "@mosoo/agent-driver/orpc";

const MAX_PROCESSED_DRIVER_EVENT_RECEIPTS = 8192;

export function filterNewDriverEvents(input: {
  events: readonly DriverEventEnvelope[];
  processedReceipts: Map<string, DriverEventReceipt>;
}): DriverEventEnvelope[] {
  const seenEventIds = new Set<string>();

  return input.events.filter((envelope) => {
    if (envelope.eventId.length === 0) {
      return true;
    }

    if (seenEventIds.has(envelope.eventId)) {
      return false;
    }

    seenEventIds.add(envelope.eventId);

    return !input.processedReceipts.has(envelope.eventId);
  });
}

export function createReceiptsForDriverEvents(input: {
  events: readonly DriverEventEnvelope[];
  nextSeq: number;
}): {
  nextSeq: number;
  receipts: DriverEventReceipt[];
} {
  let nextSeq = input.nextSeq;
  const receipts = input.events.map((envelope) => {
    nextSeq += 1;

    return {
      ...(envelope.eventId.length > 0 ? { eventId: envelope.eventId } : {}),
      seq: nextSeq,
      type: envelope.event.kind,
    };
  });

  return { nextSeq, receipts };
}

export function readReceiptsForProcessedDriverEvents(input: {
  events: readonly DriverEventEnvelope[];
  processedReceipts: Map<string, DriverEventReceipt>;
}): DriverEventReceipt[] {
  const receipts: DriverEventReceipt[] = [];

  for (const envelope of input.events) {
    if (envelope.eventId.length === 0) {
      continue;
    }

    const receipt = input.processedReceipts.get(envelope.eventId);

    if (receipt !== undefined) {
      receipts.push(receipt);
    }
  }

  return receipts;
}

export function rememberDriverEventReceipts(input: {
  processedReceipts: Map<string, DriverEventReceipt>;
  receipts: DriverEventReceipt[];
}): void {
  for (const receipt of input.receipts) {
    if (typeof receipt.eventId !== "string" || receipt.eventId.length === 0) {
      continue;
    }

    input.processedReceipts.set(receipt.eventId, receipt);
  }

  while (input.processedReceipts.size > MAX_PROCESSED_DRIVER_EVENT_RECEIPTS) {
    const oldest = input.processedReceipts.keys().next().value;

    if (typeof oldest !== "string") {
      return;
    }

    input.processedReceipts.delete(oldest);
  }
}
