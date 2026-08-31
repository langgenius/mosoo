import type { AgentKind } from "@mosoo/contracts/agent";
import type { AgentId, SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";

import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { DriverOrigin as DriverOriginValue } from "../../domain/driver-snapshot";
import type { RuntimeRunProvisioningLease } from "../runtime-subject-lifecycle/runtime-provisioning-lease-store";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";

export interface EnsureSandboxConversationSessionInput {
  agentId: AgentId;
  kind: AgentKind;
  mountSessionResources: boolean;
  origin: DriverOriginValue;
  provisioningLease?: RuntimeRunProvisioningLease;
  replaceClosedExecutionSession?: boolean;
  sandbox: SandboxHandle;
  sandboxId: SandboxId;
  sandboxIncarnation: number;
  sessionId: SessionId;
  timing?: RuntimeTimingRecorder;
}

export interface SandboxConversationSessionResult {
  cloudflareSession: ExecutionSessionHandle;
  sandboxSessionId: SandboxSessionId;
  cwd: string;
  origin: DriverOriginValue;
  provisioningLease?: RuntimeRunProvisioningLease;
}
