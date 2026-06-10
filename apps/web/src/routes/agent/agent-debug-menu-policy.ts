import type { AgentKind, AgentViewerRole } from "@mosoo/contracts/agent";
import { agentKindSupportsOwnerTerminal } from "@mosoo/contracts/agent";

export type AgentDebugMenuItemId = "files" | "system-log" | "terminal";

export function canShowAgentDebugMenuItem(input: {
  agentKind: AgentKind | null;
  itemId: AgentDebugMenuItemId;
  viewerRole: AgentViewerRole | null;
}): boolean {
  switch (input.itemId) {
    case "terminal":
      return canShowOwnerDebugTerminalItem(input);
    case "files":
    case "system-log":
      // V1 keeps Assistant Agent Debug scoped to Terminal while File Browser and System Log mature.
      return false;
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
