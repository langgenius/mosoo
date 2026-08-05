import type { AgentKind } from "@mosoo/contracts/agent";
import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";

export const ASSISTANT_LIMITED_ENVIRONMENT_REASON = "agentEditor.assistantLimitedReason";

export function getEnvironmentSelectionBlockReason(
  input: {
    kind: AgentKind;
    networkPolicy: EnvironmentNetworkPolicy;
  },
  t: (key: string) => string = (key) => key,
): string | null {
  return input.kind === "pet" && input.networkPolicy === "limited"
    ? t(ASSISTANT_LIMITED_ENVIRONMENT_REASON)
    : null;
}
