import { type } from "arktype";

import { NonEmptyString, parseSchemaValue } from "../src/validation/primitives.contract";

declare const ModelIdBrand: unique symbol;
declare const ProviderIdBrand: unique symbol;
declare const RuntimeIdBrand: unique symbol;

export type ModelId = string & { readonly [ModelIdBrand]: "ModelId" };
export type ProviderId = string & { readonly [ProviderIdBrand]: "ProviderId" };
export type RuntimeId = string & { readonly [RuntimeIdBrand]: "RuntimeId" };

export const RuntimeModelProviderKindSchema = type('"preset" | "custom"');
export type RuntimeModelProviderKind = typeof RuntimeModelProviderKindSchema.infer;

export interface RuntimeModelProviderRef {
  readonly kind: RuntimeModelProviderKind;
  readonly providerId: ProviderId;
}

export interface RuntimeModelIdentity {
  readonly modelId: ModelId;
  readonly provider: RuntimeModelProviderRef;
  readonly runtimeId: RuntimeId;
}

const RuntimeModelProviderRefInput = type({
  kind: RuntimeModelProviderKindSchema,
  providerId: NonEmptyString,
});

export const RuntimeModelIdentityInput = type({
  modelId: NonEmptyString,
  provider: RuntimeModelProviderRefInput,
  runtimeId: NonEmptyString,
});

type IdentityTokenName = "modelId" | "providerId" | "runtimeId";

function admitIdentityToken(value: string, name: IdentityTokenName): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new TypeError(`${name} is required.`);
  }

  return trimmed;
}

export function admitModelId(value: string): ModelId {
  return admitIdentityToken(value, "modelId") as ModelId;
}

export function admitProviderId(value: string): ProviderId {
  return admitIdentityToken(value, "providerId") as ProviderId;
}

export function admitRuntimeId(value: string): RuntimeId {
  return admitIdentityToken(value, "runtimeId") as RuntimeId;
}

export function createRuntimeModelProviderRef(input: {
  kind: RuntimeModelProviderKind;
  providerId: string;
}): RuntimeModelProviderRef {
  return {
    kind: input.kind,
    providerId: admitProviderId(input.providerId),
  };
}

export function createRuntimeModelIdentity(input: {
  modelId: string;
  provider: {
    kind: RuntimeModelProviderKind;
    providerId: string;
  };
  runtimeId: string;
}): RuntimeModelIdentity {
  return {
    modelId: admitModelId(input.modelId),
    provider: createRuntimeModelProviderRef(input.provider),
    runtimeId: admitRuntimeId(input.runtimeId),
  };
}

export function parseRuntimeModelIdentity(value: unknown): RuntimeModelIdentity {
  return createRuntimeModelIdentity(parseSchemaValue(RuntimeModelIdentityInput, value));
}

export function isCustomRuntimeModelProvider(provider: RuntimeModelProviderRef): boolean {
  return provider.kind === "custom";
}
