import { EventType } from "@ag-ui/core";
import type { StateSnapshotEvent } from "@ag-ui/core";

import type { MosooCustomEventValueByName, MosooServerCustomEvent } from "./ag-ui-session-events";
import type { SessionLiveState } from "./live-state";

export function createStateSnapshotEvent(snapshot: SessionLiveState): StateSnapshotEvent {
  return {
    snapshot,
    type: EventType.STATE_SNAPSHOT,
  };
}

export function createServerCustomEvent<TName extends MosooServerCustomEvent["name"]>(
  name: TName,
  value: MosooCustomEventValueByName[TName],
): Extract<MosooServerCustomEvent, { name: TName }> {
  return {
    name,
    type: EventType.CUSTOM,
    value,
  } as Extract<MosooServerCustomEvent, { name: TName }>;
}
