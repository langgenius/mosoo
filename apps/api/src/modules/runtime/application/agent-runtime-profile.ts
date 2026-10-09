import { getSessionOrganizationPath, getSessionRuntimeStatePath } from "@mosoo/agent-driver/paths";
import type { JsonObject } from "@mosoo/contracts";
import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { AccountId, AgentId, SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";

import type {
  DriverConfigRevision,
  DriverEnvironmentArtifactProfile,
  DriverNetworkProfile,
  DriverProfileConfig,
  DriverRuntime,
  DriverVendorCredentialProfile,
} from "../domain/driver-snapshot";

export function createAgentRuntimeProfile(input: {
  agentId: AgentId | null;
  callerUserId: AccountId;
  configRevision: DriverConfigRevision;
  envVars: Record<string, string>;
  environmentArtifact: DriverEnvironmentArtifactProfile | null;
  executionOwnerUserId: AccountId;
  model: string;
  modelProtocol?: PresetModelProtocol;
  network: DriverNetworkProfile;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  readiness: AgentReadiness;
  runtimeId: DriverRuntime;
  sandboxId: SandboxId;
  sandboxSessionId: SandboxSessionId;
  sessionId: SessionId;
  setupScript: string;
  vendorCredential: DriverVendorCredentialProfile;
}): DriverProfileConfig {
  return {
    agentId: input.agentId,
    configRevision: input.configRevision,
    envVars: input.envVars,
    environmentArtifact: input.environmentArtifact,
    model: input.model,
    ...(input.modelProtocol === undefined ? {} : { modelProtocol: input.modelProtocol }),
    network: input.network,
    prompt: input.prompt,
    provider: input.provider,
    providerOptions: input.providerOptions,
    readiness: input.readiness,
    runtimeId: input.runtimeId,
    sandbox: { id: input.sandboxId },
    session: {
      sandboxSessionId: input.sandboxSessionId,
      homePath: getSessionRuntimeStatePath(input.sessionId, input.runtimeId),
      origin: {
        callerUserId: input.callerUserId,
        entrypoint: "chat",
        executionOwnerUserId: input.executionOwnerUserId,
        type: "agent",
      },
      sessionOrganizationPath: getSessionOrganizationPath(input.sessionId),
    },
    setupScript: input.setupScript,
    vendorCredential: input.vendorCredential,
  };
}
