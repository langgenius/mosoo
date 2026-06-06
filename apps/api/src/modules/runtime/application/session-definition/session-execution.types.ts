import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";
import type {
  SessionExecutionBinding,
  SessionExecutionSkillReference,
  SessionExecutionSpaceReference,
  SessionExecutionToolReference,
} from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import type { ResolvedRunSkill } from "@mosoo/contracts/skill";
import type {
  DriverOrganizationAccessSnapshotOutput,
  DriverProfileConfig,
  DriverResolvedMcpServer,
  DriverSkillCatalogEntry,
} from "@mosoo/driver-protocol";
import type { EnvironmentId, EnvironmentRevisionId } from "@mosoo/id";

export interface SessionExecutionPlan {
  binding: Omit<SessionExecutionBinding, "sessionId">;
  environment: {
    allowMcpServers: boolean;
    allowPackageManagers: boolean;
    allowedHostsJson: string;
    envVarsJson: string;
    environmentId: EnvironmentId;
    environmentName: string;
    networkPolicy: EnvironmentNetworkPolicy;
    packagesJson: string;
    revisionId: EnvironmentRevisionId;
    setupScript: string;
  };
  skills: Omit<SessionExecutionSkillReference, "sessionId">[];
  spaces: Omit<SessionExecutionSpaceReference, "sessionId">[];
  tools: Omit<SessionExecutionToolReference, "sessionId">[];
}

export interface HydratedSessionRunContext {
  mcpServers: DriverResolvedMcpServer[];
  profile: DriverProfileConfig;
  skillCatalog: DriverSkillCatalogEntry[];
  skills: Omit<ResolvedRunSkill, "downloadUrl">[];
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  warnings: UserWarning[];
}
