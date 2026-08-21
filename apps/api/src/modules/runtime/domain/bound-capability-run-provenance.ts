import type { AgentId, AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";

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

/**
 * What a bound capability attaches to every Run it starts: the provenance
 * recorded on the Run row plus the D1 authority condition repeated inside the
 * Run insert, so a deletion or successful revision replacement that commits
 * mid-request cannot create an owner-billed Run.
 */
export interface BoundCapabilityRunAdmission {
  boundCapabilityProvenance: BoundCapabilityRunProvenance;
  runCreationGuard: SQL;
}
