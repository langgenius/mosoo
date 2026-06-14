import type { AgentKind } from "@mosoo/contracts/agent";
import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import type { SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";

import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type {
  DriverAppAccessSnapshotOutput,
  DriverOrigin as DriverOriginValue,
} from "../../domain/driver-snapshot";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";

export interface EnsureSandboxConversationSessionInput {
  currentAppAccessSnapshot: DriverAppAccessSnapshotOutput;
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
  sandboxSessionId: SandboxSessionId;
  cwd: string;
  origin: DriverOriginValue;
  spaceAliases: SpaceAliasBinding[];
  appAccessSnapshot: DriverAppAccessSnapshotOutput;
}
