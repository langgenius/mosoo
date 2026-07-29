import type { AgentKind } from "@mosoo/contracts/agent";
import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";

export const ASSISTANT_LIMITED_ENVIRONMENT_REASON =
  "Assistant Agents require a Full network Environment.";

export function getEnvironmentSelectionBlockReason(input: {
  kind: AgentKind;
  networkPolicy: EnvironmentNetworkPolicy;
}): string | null {
  return input.kind === "pet" && input.networkPolicy === "limited"
    ? ASSISTANT_LIMITED_ENVIRONMENT_REASON
    : null;
}
