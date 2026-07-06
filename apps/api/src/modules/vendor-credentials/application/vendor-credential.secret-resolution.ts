import { vaultSecretsTable } from "@mosoo/db";
import type { AccountId, PlatformId, AppId, VendorCredentialId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isApiError } from "../../../platform/errors";
import { ensureAppOwnership } from "../../apps/application/app.service";
import {
  deleteSecret,
  readSecretOutcome,
  storeSecret,
} from "../../vault/application/vault-secret-store";
import { findCustomCredentialRowForModel } from "./vendor-credential-custom-models";
import { parseCredentialModels } from "./vendor-credential.mapper";
import {
  getAppVendorCredentialRow,
  listAppCustomCredentialRows,
} from "./vendor-credential.repository";
import type { ResolvedVendorCredential, VendorCredentialRow } from "./vendor-credential.types";

export interface ResolveVendorApiKeyOptions {
  modelId?: string;
}

export interface ResolveVendorApiKeyRequest {
  bindings: ApiBindings;
  executionOwnerUserId: AccountId;
  options?: ResolveVendorApiKeyOptions;
  appId: AppId;
  vendorId: string;
}

export type VendorCredentialSecretReadPurpose =
  | "credential_display_api_key"
  | "custom_model_runtime_api_key"
  | "runtime_api_key";

export type VendorCredentialSecretWritePurpose =
  | "credential_create_api_key"
  | "credential_update_api_key";

export type VendorCredentialSecretDeletePurpose =
  | "credential_create_rollback"
  | "credential_delete"
  | "credential_update_replaced"
  | "credential_update_rollback";

export type VendorCredentialSecretReadDenialReason =
  | "credential_app_mismatch"
  | "credential_provider_mismatch"
  | "secret_kind_mismatch"
  | "secret_not_found";

export type VendorCredentialSecretDeleteDenialReason = "secret_kind_mismatch" | "secret_not_found";

interface VendorCredentialSecretOwner {
  credentialId: VendorCredentialId;
  appId: AppId;
  providerId: string;
}

export interface ReadVendorCredentialSecretCommand {
  credential: VendorCredentialRow;
  appId: AppId;
  providerId: string;
  purpose: VendorCredentialSecretReadPurpose;
}

export interface StoreVendorCredentialSecretCommand extends VendorCredentialSecretOwner {
  apiKey: string;
  purpose: VendorCredentialSecretWritePurpose;
}

export interface DeleteVendorCredentialSecretCommand extends VendorCredentialSecretOwner {
  purpose: VendorCredentialSecretDeletePurpose;
  secretId: PlatformId;
}

export type VendorCredentialSecretReadOutcome =
  | {
      apiKey: string;
      status: "allowed";
    }
  | {
      credentialId: VendorCredentialId;
      providerId: string;
      purpose: VendorCredentialSecretReadPurpose;
      reason: VendorCredentialSecretReadDenialReason;
      status: "denied";
    };

export type VendorCredentialSecretDeleteOutcome =
  | {
      status: "deleted";
    }
  | {
      credentialId: VendorCredentialId;
      providerId: string;
      purpose: VendorCredentialSecretDeletePurpose;
      reason: VendorCredentialSecretDeleteDenialReason;
      status: "denied";
    };

function toVendorCredentialSecretKind(owner: VendorCredentialSecretOwner): string {
  return ["vendor_credential", owner.appId, owner.providerId, owner.credentialId].join(":");
}

async function readVaultSecretKind(
  database: D1Database,
  secretId: PlatformId,
): Promise<string | null> {
  const row = await getAppDatabase(database)
    .select({ kind: vaultSecretsTable.kind })
    .from(vaultSecretsTable)
    .where(eq(vaultSecretsTable.id, secretId))
    .limit(1)
    .get();

  return row?.kind ?? null;
}

export function collectAvailableVendorIds(rows: readonly VendorCredentialRow[]): Set<string> {
  return new Set(rows.map((row) => row.vendorId));
}

export function getVendorCredentialSecretReadDenial(
  command: ReadVendorCredentialSecretCommand,
): VendorCredentialSecretReadDenialReason | null {
  if (command.credential.appId !== command.appId) {
    return "credential_app_mismatch";
  }

  if (command.credential.vendorId !== command.providerId) {
    return "credential_provider_mismatch";
  }

  return null;
}

function denyVendorCredentialSecretRead(
  command: ReadVendorCredentialSecretCommand,
  reason: VendorCredentialSecretReadDenialReason,
): VendorCredentialSecretReadOutcome {
  return {
    credentialId: command.credential.id,
    providerId: command.providerId,
    purpose: command.purpose,
    reason,
    status: "denied",
  };
}

export async function storeVendorCredentialSecret(
  bindings: ApiBindings,
  command: StoreVendorCredentialSecretCommand,
): Promise<PlatformId> {
  return storeSecret(bindings.DB, bindings, {
    kind: toVendorCredentialSecretKind(command),
    value: command.apiKey,
  });
}

export async function readVendorCredentialSecret(
  bindings: Pick<ApiBindings, "DB" | "VAULT_ROOT_SECRET">,
  command: ReadVendorCredentialSecretCommand,
): Promise<VendorCredentialSecretReadOutcome> {
  const denial = getVendorCredentialSecretReadDenial(command);

  if (denial !== null) {
    return denyVendorCredentialSecretRead(command, denial);
  }

  const expectedKind = toVendorCredentialSecretKind({
    credentialId: command.credential.id,
    appId: command.appId,
    providerId: command.providerId,
  });
  const actualKind = await readVaultSecretKind(bindings.DB, command.credential.apiKeySecretId);

  if (actualKind === null) {
    return denyVendorCredentialSecretRead(command, "secret_not_found");
  }

  if (actualKind !== expectedKind) {
    return denyVendorCredentialSecretRead(command, "secret_kind_mismatch");
  }

  const secret = await readSecretOutcome(bindings.DB, bindings, command.credential.apiKeySecretId);

  if (secret.status === "missing") {
    return denyVendorCredentialSecretRead(command, secret.reason);
  }

  return { apiKey: secret.value, status: "allowed" };
}

function denyVendorCredentialSecretDelete(
  command: DeleteVendorCredentialSecretCommand,
  reason: VendorCredentialSecretDeleteDenialReason,
): VendorCredentialSecretDeleteOutcome {
  return {
    credentialId: command.credentialId,
    providerId: command.providerId,
    purpose: command.purpose,
    reason,
    status: "denied",
  };
}

export async function deleteVendorCredentialSecret(
  database: D1Database,
  command: DeleteVendorCredentialSecretCommand,
): Promise<VendorCredentialSecretDeleteOutcome> {
  const expectedKind = toVendorCredentialSecretKind(command);
  const actualKind = await readVaultSecretKind(database, command.secretId);

  if (actualKind === null) {
    return denyVendorCredentialSecretDelete(command, "secret_not_found");
  }

  if (actualKind !== expectedKind) {
    return denyVendorCredentialSecretDelete(command, "secret_kind_mismatch");
  }

  await deleteSecret(database, command.secretId);
  return { status: "deleted" };
}

async function resolveCredentialFromRow(
  bindings: ApiBindings,
  command: ReadVendorCredentialSecretCommand,
): Promise<ResolvedVendorCredential | null> {
  const secret = await readVendorCredentialSecret(bindings, command);

  if (secret.status === "denied") {
    return null;
  }

  return {
    apiBase: command.credential.apiBase,
    apiKey: secret.apiKey,
    credentialId: command.credential.id,
    models: parseCredentialModels(command.credential.modelsJson),
  };
}

async function canResolveRuntimeCredentialForExecutionOwner(input: {
  bindings: ApiBindings;
  executionOwnerUserId: AccountId;
  appId: AppId;
}): Promise<boolean> {
  try {
    await ensureAppOwnership(input.bindings.DB, input.executionOwnerUserId, input.appId);
    return true;
  } catch (error) {
    if (isApiError(error)) {
      return false;
    }

    throw error;
  }
}

export async function resolveVendorApiKey({
  bindings,
  executionOwnerUserId,
  options = {},
  appId,
  vendorId,
}: ResolveVendorApiKeyRequest): Promise<ResolvedVendorCredential | null> {
  const modelId = options.modelId;
  const canResolveCredential = await canResolveRuntimeCredentialForExecutionOwner({
    bindings,
    executionOwnerUserId,
    appId,
  });

  if (!canResolveCredential) {
    return null;
  }

  if (vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId && modelId !== undefined) {
    const rows = await listAppCustomCredentialRows(bindings.DB, appId);
    const row = findCustomCredentialRowForModel(rows, modelId);

    if (!row) {
      return null;
    }

    return resolveCredentialFromRow(bindings, {
      credential: row,
      appId,
      providerId: vendorId,
      purpose: "custom_model_runtime_api_key",
    });
  }

  const row = await getAppVendorCredentialRow(bindings.DB, appId, vendorId);

  if (!row) {
    return null;
  }

  return resolveCredentialFromRow(bindings, {
    credential: row,
    appId,
    providerId: vendorId,
    purpose: "runtime_api_key",
  });
}
