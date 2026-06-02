import type { AgentKind } from "@mosoo/contracts/agent";
import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import type {
  DriverOrganizationAccessSnapshotOutput,
  DriverOrigin as DriverOriginValue,
} from "@mosoo/driver-protocol";
import type { SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";

import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";

export interface EnsureSandboxConversationSessionInput {
  currentOrganizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  kind: AgentKind;
  mountSessionResources: boolean;
  origin: DriverOriginValue;
  sandbox: SandboxHandle;
  sandboxId: SandboxId;
  sessionId: SessionId;
  spaceAliases: SpaceAliasBinding[];
  timing?: RuntimeTimingRecorder;
}

export interface SandboxConversationSessionResult {
  cloudflareSession: ExecutionSessionHandle;
  cloudflareSessionId: SandboxSessionId;
  cwd: string;
  origin: DriverOriginValue;
  spaceAliases: SpaceAliasBinding[];
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
}
