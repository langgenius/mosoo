import { getSessionOrganizationPath, getSessionRuntimeStatePath } from "@mosoo/agent-driver/paths";
import type { JsonObject } from "@mosoo/contracts";
import type { AgentKind, AgentReadiness } from "@mosoo/contracts/agent";
import type { AccountId, AgentId, SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";

import type {
  DriverConfigRevision,
  DriverEnvironmentArtifactProfile,
  DriverPermissionPolicy,
  DriverProfileConfig,
} from "../domain/driver-snapshot";
import { DEFAULT_DRIVER_PERMISSION_POLICY } from "../domain/driver-snapshot";
import { getSupportedRuntimeId } from "../domain/runtime-config";
import { resolveAgentRuntimeSandboxSubject } from "../domain/runtime-sandbox-subject";

export function createAgentRuntimeProfile(input: {
  agentId: AgentId;
  callerUserId: AccountId;
  configRevision: DriverConfigRevision;
  entrypoint?: "api" | "chat";
  envVars: Record<string, string>;
  environmentArtifact?: DriverEnvironmentArtifactProfile | null;
  executionOwnerUserId: AccountId;
  kind: AgentKind;
  model: string;
  permissionPolicy?: DriverPermissionPolicy;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  readiness: AgentReadiness;
  runtimeId: string;
  sandboxId: SandboxId;
  sandboxSessionId: SandboxSessionId;
  sessionId: SessionId;
  setupScript: string;
}): DriverProfileConfig {
  const runtimeId = getSupportedRuntimeId(input.runtimeId);

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${input.runtimeId}.`);
  }

  const sandboxSubject = resolveAgentRuntimeSandboxSubject(input);

  return {
    agentId: input.agentId,
    configRevision: input.configRevision,
    envVarNames: Object.keys(input.envVars),
    envVars: input.envVars,
    environmentArtifact: input.environmentArtifact ?? null,
    kind: input.kind,
    model: input.model,
    permissionPolicy: input.permissionPolicy ?? DEFAULT_DRIVER_PERMISSION_POLICY,
    prompt: input.prompt,
    provider: input.provider,
    providerOptions: input.providerOptions,
    readiness: input.readiness,
    runtimeId,
    sandbox: {
      id: input.sandboxId,
      kind: sandboxSubject.kind,
      subjectId: sandboxSubject.subjectId,
      subjectKind: sandboxSubject.subjectKind,
    },
    session: {
      sandboxSessionId: input.sandboxSessionId,
      homePath: getSessionRuntimeStatePath(input.sessionId, runtimeId),
      origin: {
        callerUserId: input.callerUserId,
        entrypoint: input.entrypoint ?? "chat",
        executionOwnerUserId: input.executionOwnerUserId,
        type: "agent",
      },
      sessionOrganizationPath: getSessionOrganizationPath(input.sessionId),
    },
    setupScript: input.setupScript,
    sourceKind: "agent",
  };
}
