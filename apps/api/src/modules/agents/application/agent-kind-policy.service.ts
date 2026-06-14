import { isTruthy } from "../../../shared/truthiness";
import type { AgentRow } from "./agent-types";

export function enforceAgentKindChangeAllowed(agent: AgentRow, nextKind: AgentRow["kind"]): void {
  const kindLocked = agent.status === "published" || isTruthy(agent.liveDeploymentVersionId);

  if (kindLocked && agent.kind !== nextKind) {
    throw new Error("Agent type is locked after publishing. Fork to switch type.");
  }
}
