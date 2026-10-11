import type { DriverModelConnection } from "@mosoo/agent-driver/boot";
import type { DriverInstanceId, VendorCredentialId } from "@mosoo/id";
import { getVendor, resolveRuntimeModelProtocol } from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../../shared/truthiness";
import type { DriverProfileConfig } from "../../domain/driver-snapshot";
import { RUNTIME_RUN_RETENTION_MS } from "../../domain/runtime-config";
import { getRuntimeDriverLlmProxyPath } from "../../domain/runtime-driver-routes";
import {
  RUNTIME_LLM_PROXY_MODEL_ID_MAX_LENGTH,
  createRuntimeActionToken,
} from "../runtime-boot-token";
import type { RuntimeActionTokenBindings } from "../runtime-boot-token";

const OPENAI_IMAGE_MODEL_ID = "gpt-image-2";

export interface RuntimeModelConnectionInput {
  bindings: RuntimeActionTokenBindings;
  driverInstanceId: DriverInstanceId;
  profile: Pick<DriverProfileConfig, "model" | "modelProtocol" | "runtimeId" | "vendorCredential">;
  requestUrl: string;
}

function getRuntimeLlmProxyUrl(requestUrl: string, credentialId: VendorCredentialId): string {
  const url = new URL(requestUrl);
  url.pathname = getRuntimeDriverLlmProxyPath(credentialId);
  url.search = "";
  return url.toString();
}

export async function buildModelConnection(
  input: RuntimeModelConnectionInput,
): Promise<DriverModelConnection> {
  const credential = input.profile.vendorCredential;
  const vendor = getVendor(credential.vendorId);
  if (vendor === null) throw new Error(`Unknown vendor: ${credential.vendorId}.`);
  if (credential.vendorId === "openai-compatible" && !isTruthy(credential.apiBase)) {
    throw new Error("Custom providers require an endpoint.");
  }

  const prefix = `${vendor.vendorId}/`;
  const modelId = input.profile.model.startsWith(prefix)
    ? input.profile.model.slice(prefix.length)
    : input.profile.model;
  if (modelId.length === 0 || modelId.length > RUNTIME_LLM_PROXY_MODEL_ID_MAX_LENGTH) {
    throw new Error(`Model ${input.profile.model} cannot be bound to an LLM proxy grant.`);
  }
  const resolution = resolveRuntimeModelProtocol({
    runtimeId: input.profile.runtimeId,
    modelId,
    vendorId: vendor.vendorId,
    customModelProtocol: credential.modelProtocol ?? null,
  });
  if (!resolution.ok) throw new Error(resolution.message);
  if (
    input.profile.modelProtocol !== undefined &&
    input.profile.modelProtocol !== resolution.modelProtocol
  ) {
    throw new Error("The provider model protocol differs from the frozen execution configuration.");
  }
  const protocol = input.profile.modelProtocol ?? resolution.modelProtocol;
  const proxyGrant = await createRuntimeActionToken(input.bindings, {
    action: "llm_proxy",
    projectId: credential.projectId,
    driverInstanceId: input.driverInstanceId,
    expiresAt: Date.now() + RUNTIME_RUN_RETENTION_MS,
    ...(input.profile.runtimeId === "openai-runtime" && vendor.vendorId === "openai"
      ? { imageModelId: OPENAI_IMAGE_MODEL_ID }
      : {}),
    modelId,
    modelProtocol: protocol,
    resourceId: credential.credentialId,
  });

  return {
    protocol,
    proxyGrant,
    proxyUrl: getRuntimeLlmProxyUrl(input.requestUrl, credential.credentialId),
  };
}
