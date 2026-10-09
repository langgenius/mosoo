import { EventType } from "@ag-ui/core";
import { parseSchemaValue } from "@mosoo/contracts/validation";

import type { MosooServerCustomEvent } from "./ag-ui-session-events";
import { MosooCustomEventSchema } from "./custom-event-schema";

const strictMosooCustomEventSchema = MosooCustomEventSchema.onDeepUndeclaredKey("delete");

export function parseServerCustomEvent(name: string, value: unknown): MosooServerCustomEvent {
  return parseSchemaValue(strictMosooCustomEventSchema, {
    name,
    type: EventType.CUSTOM,
    value,
  }) as MosooServerCustomEvent;
}
