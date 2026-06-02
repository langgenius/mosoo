import { createCatalogRuntimeModelIdentity } from "@mosoo/runtime-catalog";

export interface AgentRuntimeModelIdentitySource {
  model: string;
  provider: string;
  runtimeId: string;
}

export interface AgentRuntimeModelProjection {
  model: string;
  provider: string;
  runtimeId: string;
}

export function toAgentRuntimeModelProjection(
  source: AgentRuntimeModelIdentitySource,
): AgentRuntimeModelProjection {
  const identity = createCatalogRuntimeModelIdentity({
    modelId: source.model,
    providerId: source.provider,
    runtimeId: source.runtimeId,
  });

  return {
    model: identity.modelId,
    provider: identity.provider.providerId,
    runtimeId: identity.runtimeId,
  };
}
