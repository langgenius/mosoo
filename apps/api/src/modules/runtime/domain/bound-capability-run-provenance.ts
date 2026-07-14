import type { AgentId, AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";

/**
 * Immutable authorization facts captured when a bound Agent capability accepts
 * a Run. The raw URL and signed token are deliberately excluded.
 */
export interface BoundCapabilityRunProvenance {
  agentId: AgentId;
  appId: AppId;
  bindingEnv: string;
  bindingName: string;
  deploymentId: AppDeploymentId;
  deploymentRunId: AppDeploymentRunId;
}
