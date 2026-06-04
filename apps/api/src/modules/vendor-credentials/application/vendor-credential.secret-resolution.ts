import type { VendorCredentialScope } from "@mosoo/contracts/vendor-credential";
import { vaultSecretsTable } from "@mosoo/db";
import type { AccountId, OrganizationId, PlatformId, VendorCredentialId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  deleteSecret,
  readSecretOutcome,
  storeSecret,
} from "../../mcp/application/mcp-secret-store";
import { findCustomCredentialRowForModel } from "./vendor-credential-custom-models";
import { credentialScope } from "./vendor-credential.mapper";
import {
  getCompanyCredentialRow,
  getPreferredPersonalCredentialRow,
  listReachableCustomCredentialRows,
} from "./vendor-credential.repository";
import type { ResolvedVendorCredential, VendorCredentialRow } from "./vendor-credential.types";

export interface ResolveVendorApiKeyOptions {
  modelId?: string;
}

export interface ResolveVendorApiKeyRequest {
  actorAccountId: AccountId;
  bindings: ApiBindings;
  options?: ResolveVendorApiKeyOptions;
  organizationId: OrganizationId;
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
  | "credential_organization_mismatch"
  | "credential_owner_mismatch"
  | "credential_provider_mismatch"
  | "secret_kind_mismatch"
  | "secret_not_found";

export type VendorCredentialSecretDeleteDenialReason =
  | "credential_owner_mismatch"
  | "secret_kind_mismatch"
  | "secret_not_found";

interface VendorCredentialSecretOwner {
  actorAccountId: AccountId;
  credentialId: VendorCredentialId;
  organizationId: OrganizationId;
  ownerAccountId: AccountId | null;
  providerId: string;
  scope: VendorCredentialScope;
}

export interface ReadVendorCredentialSecretCommand {
  actorAccountId: AccountId;
  credential: VendorCredentialRow;
  organizationId: OrganizationId;
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
  if (owner.scope === "company" && owner.ownerAccountId !== null) {
    throw new Error("Company vendor credential secret cannot have an owner.");
  }

  if (owner.scope === "personal" && owner.ownerAccountId === null) {
    throw new Error("Personal vendor credential secret requires an owner.");
  }

  return [
    "vendor_credential",
    owner.organizationId,
    owner.providerId,
    owner.scope,
    owner.ownerAccountId ?? "company",
    owner.credentialId,
  ].join(":");
}

function getVendorCredentialSecretActorDenial(
  command: VendorCredentialSecretOwner,
): "credential_owner_mismatch" | null {
  if (command.scope === "personal" && command.ownerAccountId !== command.actorAccountId) {
    return "credential_owner_mismatch";
  }

  return null;
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

export function collectAvailableVendorIds(
  actorAccountId: string,
  rows: readonly VendorCredentialRow[],
): Set<string> {
  const availabilityByVendorId = new Map<
    string,
    { hasCompanyCredential: boolean; hasPreferredPersonalCredential: boolean }
  >();
  const availableVendorIds = new Set<string>();

  for (const row of rows) {
    const vendorId = row.vendorId;
    let availability = availabilityByVendorId.get(vendorId);

    if (availability === undefined) {
      availability = {
        hasCompanyCredential: false,
        hasPreferredPersonalCredential: false,
      };
      availabilityByVendorId.set(vendorId, availability);
    }

    if (row.ownerUserId === null) {
      availability.hasCompanyCredential = true;
      continue;
    }

    if (row.ownerUserId === actorAccountId && row.isPreferred === 1) {
      availability.hasPreferredPersonalCredential = true;
    }
  }

  for (const [vendorId, availability] of availabilityByVendorId) {
    if (availability.hasCompanyCredential || availability.hasPreferredPersonalCredential) {
      availableVendorIds.add(vendorId);
    }
  }

  return availableVendorIds;
}

export function getVendorCredentialSecretReadDenial(
  command: ReadVendorCredentialSecretCommand,
): VendorCredentialSecretReadDenialReason | null {
  if (command.credential.organizationId !== command.organizationId) {
    return "credential_organization_mismatch";
  }

  if (command.credential.vendorId !== command.providerId) {
    return "credential_provider_mismatch";
  }

  if (
    command.credential.ownerUserId !== null &&
    command.credential.ownerUserId !== command.actorAccountId
  ) {
    return "credential_owner_mismatch";
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
  const denial = getVendorCredentialSecretActorDenial(command);

  if (denial !== null) {
    throw new Error(`Vendor credential secret write denied: ${denial}.`);
  }

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

  const scope = credentialScope(command.credential);
  const expectedKind = toVendorCredentialSecretKind({
    actorAccountId: command.actorAccountId,
    credentialId: command.credential.id,
    organizationId: command.organizationId,
    ownerAccountId: command.credential.ownerUserId,
    providerId: command.providerId,
    scope,
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
  const actorDenial = getVendorCredentialSecretActorDenial(command);

  if (actorDenial !== null) {
    return denyVendorCredentialSecretDelete(command, actorDenial);
  }

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
    scope: credentialScope(command.credential),
  };
}

export async function resolveVendorApiKey({
  actorAccountId,
  bindings,
  options = {},
  organizationId,
  vendorId,
}: ResolveVendorApiKeyRequest): Promise<ResolvedVendorCredential | null> {
  const modelId = options.modelId;

  if (vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId && modelId !== undefined) {
    const rows = await listReachableCustomCredentialRows(
      bindings.DB,
      actorAccountId,
      organizationId,
    );
    const row = findCustomCredentialRowForModel(rows, modelId);

    if (!row) {
      return null;
    }

    return resolveCredentialFromRow(bindings, {
      actorAccountId,
      credential: row,
      organizationId,
      providerId: vendorId,
      purpose: "custom_model_runtime_api_key",
    });
  }

  const personal = await getPreferredPersonalCredentialRow({
    actorAccountId,
    database: bindings.DB,
    organizationId,
    vendorId,
  });
  const row = personal ?? (await getCompanyCredentialRow(bindings.DB, organizationId, vendorId));

  if (!row) {
    return null;
  }

  return resolveCredentialFromRow(bindings, {
    actorAccountId,
    credential: row,
    organizationId,
    providerId: vendorId,
    purpose: "runtime_api_key",
  });
}
