import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { projectRuntimeEventToAgUiSessionEvents } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { applyAgUiEventsToSessionLiveState } from "../infrastructure/session-live-state.reducer";
import type { SessionLiveState } from "../infrastructure/session-live-state.types";

export { createInitialSessionLiveState } from "../infrastructure/session-live-state.reducer";
export { applyAgUiEventToSessionLiveState } from "../infrastructure/session-live-state.reducer";
export {
  loadSessionViewerState,
  type LoadSessionViewerStateInput,
} from "../infrastructure/session-viewer-live-snapshot.repository";
export {
  type AgUiEvent,
  type SessionLiveState,
  type SessionLiveStateMessage,
  type SessionPermissionRequestView,
  type SessionViewSegment,
} from "../infrastructure/session-live-state.types";

export type SessionDeliveryEvent = AgUiSessionEvent;

export function projectRuntimeEventToSessionDeliveryEvents(
  event: RuntimeEventEnvelope,
): SessionDeliveryEvent[] {
  return projectRuntimeEventToAgUiSessionEvents(event);
}

export function applyRuntimeEventToSessionLiveState(
  state: SessionLiveState,
  event: RuntimeEventEnvelope,
): SessionLiveState {
  return applyRuntimeEventsToSessionLiveState(state, [event]);
}

function applyRuntimeEventsToSessionLiveState(
  state: SessionLiveState,
  events: readonly RuntimeEventEnvelope[],
): SessionLiveState {
  let next = state;

  for (const event of events) {
    next = applyAgUiEventsToSessionLiveState(
      next,
      projectRuntimeEventToSessionDeliveryEvents(event),
    );
  }

  return next;
}
