import { serializeAgUiSessionEvents } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import { getBroadcastableSessionDeliveryEvents } from "../../domain/session-delivery-event-visibility";
import { applyAgUiEventsToSessionLiveState } from "../session-live-state.reducer";
import type { SessionLiveState } from "../session-live-state.types";

interface BuildViewerBroadcastFramesOptions {
  cachedState: SessionLiveState | null;
  events: AgUiSessionEvent[];
}

interface ViewerBroadcastFrames {
  frames: string[];
  state: SessionLiveState | null;
}

export function buildViewerBroadcastFrames(
  options: BuildViewerBroadcastFramesOptions,
): ViewerBroadcastFrames | null {
  const deliveryEvents = getBroadcastableSessionDeliveryEvents(options.events);

  if (deliveryEvents.length === 0) {
    return null;
  }

  return {
    frames: serializeAgUiSessionEvents(deliveryEvents),
    state:
      options.cachedState === null
        ? null
        : applyAgUiEventsToSessionLiveState(options.cachedState, deliveryEvents),
  };
}
