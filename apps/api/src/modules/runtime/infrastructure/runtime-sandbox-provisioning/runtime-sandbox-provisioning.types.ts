import type { DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import type { RuntimeTimingSnapshot } from "../../application/session-runs/session-runtime-timing";
import type {
  DriverProfileConfig,
  DriverExecutionSpec,
  DriverResolvedMcpServer,
  DriverResolvedSkill,
  DriverRuntime,
  DriverSkillCatalogEntry,
} from "../../domain/driver-snapshot";
import type {
  ExecutionSessionHandle,
  RuntimeProcessHandle,
  SandboxHandle,
} from "../sandbox-handles";

export interface RuntimeSmokeProvision {
  bootTokenHash: Uint8Array;
  driverGeneration: number;
  driverInstanceId: DriverInstanceId;
  timing: RuntimeTimingSnapshot;
  process: RuntimeProcessHandle;
  sandboxId: SandboxId;
}

export interface ProvisionDriverInput {
  builtInTools: DriverExecutionSpec["builtInTools"];
  cloudflareSession: ExecutionSessionHandle;
  driverInstanceId: DriverInstanceId;
  profile: DriverProfileConfig;
  requestUrl: string;
  resolvedMcpServers: DriverResolvedMcpServer[];
  resolvedSkillCatalog: DriverSkillCatalogEntry[];
  resolvedSkills: Omit<DriverResolvedSkill, "downloadUrl">[];
  runtime: DriverRuntime;
  sandbox: SandboxHandle;
  sandboxSessionId: SessionId;
  sessionRunId?: SessionRunId | null;
}
