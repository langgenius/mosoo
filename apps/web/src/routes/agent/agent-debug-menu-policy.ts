import type { AgentKind, AgentViewerRole } from "@mosoo/contracts/agent";
import { agentKindSupportsOwnerTerminal } from "@mosoo/contracts/agent";

export type AgentDebugMenuItemId = "terminal";

export function canShowAgentDebugMenuItem(input: {
  agentKind: AgentKind | null;
  itemId: AgentDebugMenuItemId;
  viewerRole: AgentViewerRole | null;
}): boolean {
  switch (input.itemId) {
    case "terminal":
      return canShowOwnerDebugTerminalItem(input);
  }
}

export function canShowOwnerDebugTerminalItem(input: {
  agentKind: AgentKind | null;
  viewerRole: AgentViewerRole | null;
}): boolean {
  return (
    input.agentKind !== null &&
    agentKindSupportsOwnerTerminal(input.agentKind) &&
    input.viewerRole === "owner"
  );
}
