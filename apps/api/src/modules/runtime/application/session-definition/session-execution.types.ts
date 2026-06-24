import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";
import type {
  SessionExecutionBinding,
  SessionExecutionSkillReference,
  SessionExecutionToolReference,
} from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import type { ResolvedRunSkill } from "@mosoo/contracts/skill";
import type { EnvironmentId, EnvironmentRevisionId } from "@mosoo/id";

import type {
  DriverProfileConfig,
  DriverResolvedMcpServer,
  DriverSkillCatalogEntry,
} from "../../domain/driver-snapshot";

export interface SessionExecutionPlan {
  binding: Omit<SessionExecutionBinding, "sessionId">;
  builtInTools: AgentBuiltInToolConfig[];
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
  tools: Omit<SessionExecutionToolReference, "sessionId">[];
}

export interface HydratedSessionRunContext {
  builtInTools: AgentBuiltInToolConfig[];
  mcpServers: DriverResolvedMcpServer[];
  profile: DriverProfileConfig;
  skillCatalog: DriverSkillCatalogEntry[];
  skills: Omit<ResolvedRunSkill, "downloadUrl">[];
  warnings: UserWarning[];
}
