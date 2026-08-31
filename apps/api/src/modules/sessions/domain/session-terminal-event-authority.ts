import {
  readRuntimeEventPayload,
  readRuntimeEventString,
  readRuntimeRunPayload,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { readSessionRuntimeEventSemanticAuthority } from "./session-runtime-event-authority";
import { createSessionRuntimeEventProjection } from "./session-runtime-event-projection";

export interface TerminalEventSemanticAuthority {
  readonly event: RuntimeEventEnvelope;
  readonly finalMessageId: string | null;
  readonly lifecycle: "IDLE" | "TERMINATED";
}

export async function readTerminalEventSemanticAuthority(input: {
  eventJson: string | null;
  eventType: string;
  runId: string;
  semanticHash: string | null;
  sessionId: string;
  sourceEventId: string;
  streamId: string | null;
}): Promise<TerminalEventSemanticAuthority> {
  const event: RuntimeEventEnvelope = await readSessionRuntimeEventSemanticAuthority({
    eventJson: input.eventJson,
    invalidMessage: `Session run ${input.runId} has an invalid durable terminal semantic authority.`,
    missingMessage: `Session run ${input.runId} has no durable terminal semantic authority.`,
    semanticHash: input.semanticHash,
  });

  const projection = createSessionRuntimeEventProjection(event);
  const runtimeRun = readRuntimeRunPayload(event);
  const finalMessageId =
    event.kind === "run.completed"
      ? readRuntimeEventString(readRuntimeEventPayload(event), "finalMessageId")
      : null;
  if (
    event.kind !== input.eventType ||
    event.runId !== input.runId ||
    event.sessionId !== input.sessionId ||
    event.sourceEventId !== input.sourceEventId ||
    projection.eventType !== input.eventType ||
    projection.runId !== input.runId ||
    projection.streamId !== input.streamId ||
    runtimeRun.run?.id !== input.runId ||
    (runtimeRun.lifecycle !== "IDLE" && runtimeRun.lifecycle !== "TERMINATED") ||
    finalMessageId !== input.streamId
  ) {
    throw new Error(`Session run ${input.runId} terminal semantic authority is invalid.`);
  }

  return { event, finalMessageId, lifecycle: runtimeRun.lifecycle };
}
