import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
  DriverProfileConfig,
  DriverResolvedMcpServer,
  DriverResolvedSkill,
  DriverRuntime,
  DriverSkillCatalogEntry,
} from "@mosoo/driver-protocol";
import type { DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import type { RuntimeTimingSnapshot } from "../../application/session-runs/session-runtime-timing";
import type {
  ExecutionSessionHandle,
  RuntimeProcessHandle,
  SandboxHandle,
} from "../sandbox-handles";

export interface RuntimeSmokeProvision {
  bootPayload: DriverBootPayload;
  bootTokenHash: Uint8Array;
  driverGeneration: number;
  driverInstanceId: DriverInstanceId;
  timing: RuntimeTimingSnapshot;
  process: RuntimeProcessHandle;
  sandbox: SandboxHandle;
  sandboxId: SandboxId;
}

export interface ProvisionDriverInput {
  cloudflareSession: ExecutionSessionHandle;
  driverRecordConflictStrategy?: "insert-only" | "replace";
  driverInstanceId: DriverInstanceId;
  onBootPayloadPrepared?: (payload: DriverBootPayload) => Promise<void>;
  profile: DriverProfileConfig;
  requestUrl: string;
  resolvedMcpServers: DriverResolvedMcpServer[];
  resolvedSkillCatalog: DriverSkillCatalogEntry[];
  resolvedSkills: Omit<DriverResolvedSkill, "downloadUrl">[];
  runtime: DriverRuntime;
  sandbox: SandboxHandle;
  sandboxSessionId: SessionId;
  sessionRunId?: SessionRunId | null;
  traceId?: string | null;
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
}
