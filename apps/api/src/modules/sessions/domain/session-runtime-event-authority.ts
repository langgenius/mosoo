import {
  createRuntimeEventSemanticHash,
  parseRuntimeEventEnvelope,
  stringifyRuntimeEventSemanticValue,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export async function readSessionRuntimeEventSemanticAuthority(input: {
  readonly eventJson: string | null;
  readonly invalidMessage: string;
  readonly missingMessage: string;
  readonly semanticHash: string | null;
}): Promise<RuntimeEventEnvelope> {
  if (input.eventJson === null || input.semanticHash === null) {
    throw new Error(input.missingMessage);
  }

  let event: RuntimeEventEnvelope;
  try {
    event = parseRuntimeEventEnvelope(JSON.parse(input.eventJson));
  } catch {
    throw new Error(input.invalidMessage);
  }

  if (
    stringifyRuntimeEventSemanticValue(event) !== input.eventJson ||
    (await createRuntimeEventSemanticHash(event)) !== input.semanticHash
  ) {
    throw new Error(input.invalidMessage);
  }

  return event;
}
