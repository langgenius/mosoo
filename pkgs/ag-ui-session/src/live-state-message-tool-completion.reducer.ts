import type { SessionLiveState } from "./live-state";

export function completeToolUse(state: SessionLiveState, toolCallId: string): SessionLiveState {
  void toolCallId;
  return state;
}

export function completePendingToolUses(state: SessionLiveState): SessionLiveState {
  return state;
}
