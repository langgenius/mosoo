import type {
  CreateVendorCredentialInput,
  DeleteVendorCredentialInput,
  SetDefaultVendorCredentialInput,
  UpdateVendorCredentialInput,
  VendorCredential,
} from "@mosoo/contracts/vendor-credential";
import { vendorCredentialsTable } from "@mosoo/db";
import { ignorePromiseRejection } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { VendorCredentialId } from "@mosoo/id";
import { getVendor } from "@mosoo/runtime-catalog";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  enforceApiBaseAllowed,
  enforceCredentialModelShape,
  normalizeApiBase,
  normalizeCredentialModels,
  normalizeCredentialName,
} from "./vendor-credential-validation";
import { parseCredentialModels, toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import {
  getCredentialRow,
  getAppCredentialRow,
  getAppVendorCredentialRow,
} from "./vendor-credential.repository";
import {
  deleteVendorCredentialSecret,
  readVendorCredentialSecret,
  storeVendorCredentialSecret,
} from "./vendor-credential.secret-resolution";
import type { VendorCredentialRow } from "./vendor-credential.types";

function toSecretOwnerCommand(row: VendorCredentialRow) {
  return {
    credentialId: row.id,
    appId: row.appId,
    providerId: row.vendorId,
  };
}

function ensureVendorCredentialSecretDeleted(
  outcome: Awaited<ReturnType<typeof deleteVendorCredentialSecret>>,
): void {
  if (outcome.status === "denied") {
    throw new Error(`Vendor credential secret delete denied: ${outcome.reason}.`);
  }
}

async function toVisibleVendorCredential(
  bindings: ApiBindings,
  row: VendorCredentialRow,
): Promise<VendorCredential> {
  const secret = await readVendorCredentialSecret(bindings, {
    credential: row,
    appId: row.appId,
    providerId: row.vendorId,
    purpose: "credential_display_api_key",
  });

  if (secret.status === "denied") {
    throw new Error("Vendor credential secret is unavailable.");
  }

  return toVendorCredentialWithSecret(row, secret.apiKey);
}

export async function createVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateVendorCredentialInput,
): Promise<VendorCredential> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const name = normalizeCredentialName(input.name);
  const apiKey = input.apiKey.trim();
  const apiBase = normalizeApiBase(input.apiBase);
  const models = normalizeCredentialModels(input.models);

  if (getVendor(input.vendorId) === null) {
    throw new Error(`Unknown vendor: ${input.vendorId}.`);
  }
  enforceApiBaseAllowed(input.vendorId, apiBase);
  enforceCredentialModelShape(input.vendorId, apiBase, models);

  if (!apiKey) {
    throw new Error("API key is required.");
  }

  // The first credential added for a vendor becomes its default, so the runtime
  // always has exactly one credential to resolve until the user picks another.
  const isFirstForVendor =
    (await getAppVendorCredentialRow(bindings.DB, input.appId, input.vendorId)) === null;
  const id = createPlatformId<VendorCredentialId>();
  const timestampMs = currentTimestampMs();
  const secretId = await storeVendorCredentialSecret(bindings, {
    apiKey,
    credentialId: id,
    appId: input.appId,
    providerId: input.vendorId,
    purpose: "credential_create_api_key",
  });

  try {
    await getAppDatabase(bindings.DB)
      .insert(vendorCredentialsTable)
      .values({
        apiBase,
        apiKeySecretId: secretId,
        createdAt: timestampMs,
        id,
        isDefault: isFirstForVendor,
        models,
        name,
        appId: input.appId,
        updatedAt: timestampMs,
        vendorId: input.vendorId,
      })
      .run();
  } catch (error) {
    await deleteVendorCredentialSecret(bindings.DB, {
      credentialId: id,
      appId: input.appId,
      providerId: input.vendorId,
      purpose: "credential_create_rollback",
      secretId,
    }).catch(ignorePromiseRejection);
    throw error;
  }

  const row = await getCredentialRow(bindings.DB, id);

  if (!row) {
    throw new Error("Vendor credential could not be loaded.");
  }

  return toVisibleVendorCredential(bindings, row);
}

export async function updateVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: UpdateVendorCredentialInput,
): Promise<VendorCredential> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const row = await getAppCredentialRow(bindings.DB, input.appId, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  const name = input.name !== undefined ? normalizeCredentialName(input.name) : row.name;
  const apiBase = input.apiBase !== undefined ? normalizeApiBase(input.apiBase) : row.apiBase;
  const models =
    input.models !== undefined
      ? normalizeCredentialModels(input.models)
      : parseCredentialModels(row.modelsJson);
  enforceApiBaseAllowed(row.vendorId, apiBase);
  enforceCredentialModelShape(row.vendorId, apiBase, models);
  const nextSecretId =
    input.apiKey?.trim() !== null &&
    input.apiKey?.trim() !== undefined &&
    input.apiKey?.trim() !== ""
      ? await storeVendorCredentialSecret(bindings, {
          ...toSecretOwnerCommand(row),
          apiKey: input.apiKey.trim(),
          purpose: "credential_update_api_key",
        })
      : row.apiKeySecretId;

  try {
    await getAppDatabase(bindings.DB)
      .update(vendorCredentialsTable)
      .set({
        apiBase,
        apiKeySecretId: nextSecretId,
        models,
        name,
        updatedAt: currentTimestampMs(),
      })
      .where(
        and(eq(vendorCredentialsTable.id, input.id), eq(vendorCredentialsTable.appId, input.appId)),
      )
      .run();
  } catch (error) {
    if (nextSecretId !== row.apiKeySecretId) {
      await deleteVendorCredentialSecret(bindings.DB, {
        ...toSecretOwnerCommand(row),
        purpose: "credential_update_rollback",
        secretId: nextSecretId,
      }).catch(ignorePromiseRejection);
    }
    throw error;
  }

  if (nextSecretId !== row.apiKeySecretId) {
    ensureVendorCredentialSecretDeleted(
      await deleteVendorCredentialSecret(bindings.DB, {
        ...toSecretOwnerCommand(row),
        purpose: "credential_update_replaced",
        secretId: row.apiKeySecretId,
      }),
    );
  }

  const updated = await getAppCredentialRow(bindings.DB, input.appId, input.id);

  if (!updated) {
    throw new Error("Vendor credential could not be loaded.");
  }

  return toVisibleVendorCredential(bindings, updated);
}

export async function setDefaultVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SetDefaultVendorCredentialInput,
): Promise<VendorCredential> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const row = await getAppCredentialRow(bindings.DB, input.appId, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  // Clear the current default for this vendor and promote the chosen credential
  // in one batch so there is always exactly one default per vendor.
  const timestampMs = currentTimestampMs();
  await runAppDatabaseBatch(bindings.DB, (database) => [
    database
      .update(vendorCredentialsTable)
      .set({ isDefault: false, updatedAt: timestampMs })
      .where(
        and(
          eq(vendorCredentialsTable.appId, input.appId),
          eq(vendorCredentialsTable.vendorId, row.vendorId),
        ),
      ),
    database
      .update(vendorCredentialsTable)
      .set({ isDefault: true, updatedAt: timestampMs })
      .where(
        and(eq(vendorCredentialsTable.id, input.id), eq(vendorCredentialsTable.appId, input.appId)),
      ),
  ]);

  const updated = await getAppCredentialRow(bindings.DB, input.appId, input.id);

  if (!updated) {
    throw new Error("Vendor credential could not be loaded.");
  }

  return toVisibleVendorCredential(bindings, updated);
}

export async function deleteVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: DeleteVendorCredentialInput,
): Promise<void> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const row = await getAppCredentialRow(bindings.DB, input.appId, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  await getAppDatabase(bindings.DB)
    .delete(vendorCredentialsTable)
    .where(
      and(eq(vendorCredentialsTable.id, input.id), eq(vendorCredentialsTable.appId, input.appId)),
    )
    .run();
  ensureVendorCredentialSecretDeleted(
    await deleteVendorCredentialSecret(bindings.DB, {
      ...toSecretOwnerCommand(row),
      purpose: "credential_delete",
      secretId: row.apiKeySecretId,
    }),
  );

  // Deleting the default leaves the vendor with no default; promote the next
  // remaining credential so resolution stays deterministic.
  if (row.isDefault) {
    const nextDefault = await getAppVendorCredentialRow(bindings.DB, input.appId, row.vendorId);

    if (nextDefault) {
      await getAppDatabase(bindings.DB)
        .update(vendorCredentialsTable)
        .set({ isDefault: true, updatedAt: currentTimestampMs() })
        .where(
          and(
            eq(vendorCredentialsTable.id, nextDefault.id),
            eq(vendorCredentialsTable.appId, input.appId),
          ),
        )
        .run();
    }
  }
}
