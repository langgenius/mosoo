import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { projectRuntimeEventToAgUiSessionEvents } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export {
  applyAgUiEventToSessionLiveState,
  createInitialSessionLiveState,
} from "@mosoo/ag-ui-session";
export type {
  SessionLiveState,
  SessionLiveStateMessage,
  SessionPermissionRequestView,
  SessionViewSegment,
} from "@mosoo/ag-ui-session";
export { loadSessionViewerState } from "../infrastructure/session-viewer-live-snapshot.repository";

export type SessionDeliveryEvent = AgUiSessionEvent;

export function projectRuntimeEventToSessionDeliveryEvents(
  event: RuntimeEventEnvelope,
): SessionDeliveryEvent[] {
  return projectRuntimeEventToAgUiSessionEvents(event);
}

export function projectRuntimeEventsToSessionDeliveryEvents(
  events: readonly RuntimeEventEnvelope[],
): SessionDeliveryEvent[] {
  return events.flatMap((event) => projectRuntimeEventToAgUiSessionEvents(event));
}
