import type { MosooCustomEvent } from "./ag-ui-session-events";
import { MOSOO_CUSTOM_EVENT as CUSTOM_EVENT_REGISTRY } from "./custom-event-registry";
import type { SessionLiveState } from "./live-state";
import { touchSessionLiveState } from "./live-state.reducer-core";

export function updateSessionMetadataState(
  state: SessionLiveState,
  event: MosooCustomEvent,
): SessionLiveState {
  // This switch intentionally handles the non-runtime metadata slice of MosooCustomEvent.
  switch (event.name) {
    case CUSTOM_EVENT_REGISTRY.sessionCommandsUpdated.name: {
      return touchSessionLiveState({
        ...state,
        commands: event.value.commands,
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionModeUpdated.name: {
      return touchSessionLiveState({
        ...state,
        currentModeId: event.value.currentModeId,
        visibleModes: event.value.visibleModes,
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionConfigUpdated.name: {
      return touchSessionLiveState({
        ...state,
        configOptions: event.value.configOptions,
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionUsageUpdated.name: {
      return touchSessionLiveState({
        ...state,
        usage: event.value.usage,
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionInfoUpdated.name: {
      return touchSessionLiveState({
        ...state,
        title: "title" in event.value ? event.value.title : state.title,
        updatedAt: "updatedAt" in event.value ? event.value.updatedAt : state.updatedAt,
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionConfigTrace.name:
    case CUSTOM_EVENT_REGISTRY.sessionSyncRequest.name: {
      return state;
    }
    default: {
      return state;
    }
  }
}
