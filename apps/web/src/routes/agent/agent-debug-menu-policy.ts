import type { AgentKind, AgentViewerRole } from "@mosoo/contracts/agent";
import { agentKindSupportsOwnerTerminal } from "@mosoo/contracts/agent";

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
