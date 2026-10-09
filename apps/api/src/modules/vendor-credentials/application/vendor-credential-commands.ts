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
import { VENDOR_OPENAI_COMPATIBLE, getVendor } from "@mosoo/runtime-catalog";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { deleteSecret, readSecret, storeSecret } from "../../vault/application/vault-secret-store";
import {
  enforceApiBaseAllowed,
  enforceCredentialModelShape,
  normalizeApiBase,
  normalizeCredentialModels,
  normalizeCredentialModelProtocol,
  normalizeCredentialName,
} from "./vendor-credential-validation";
import { parseCredentialModels, toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import {
  getCredentialRow,
  getProjectCredentialRow,
  getProjectVendorCredentialRow,
} from "./vendor-credential.repository";
import type { VendorCredentialRow } from "./vendor-credential.types";

const VENDOR_API_KEY_SECRET_KIND = "vendor_api_key";

async function toVisibleVendorCredential(
  bindings: ApiBindings,
  row: VendorCredentialRow,
): Promise<VendorCredential> {
  return toVendorCredentialWithSecret(
    row,
    await readSecret(bindings.DB, bindings, row.apiKeySecretId),
  );
}

export async function createVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateVendorCredentialInput,
): Promise<VendorCredential> {
  await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const name = normalizeCredentialName(input.name);
  const apiKey = input.apiKey.trim();
  const apiBase = normalizeApiBase(input.apiBase);
  const models = normalizeCredentialModels(input.models);
  const modelProtocol =
    normalizeCredentialModelProtocol(input.vendorId, input.modelProtocol) ??
    (input.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId ? "openai-chat-completions" : null);

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
    (await getProjectVendorCredentialRow(bindings.DB, input.projectId, input.vendorId)) === null;
  const id = createPlatformId<VendorCredentialId>();
  const timestampMs = currentTimestampMs();
  const secretId = await storeSecret(bindings.DB, bindings, {
    kind: VENDOR_API_KEY_SECRET_KIND,
    value: apiKey,
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
        modelProtocol,
        models,
        name,
        projectId: input.projectId,
        updatedAt: timestampMs,
        vendorId: input.vendorId,
      })
      .run();
  } catch (error) {
    await deleteSecret(bindings.DB, secretId).catch(ignorePromiseRejection);
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
  await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const row = await getProjectCredentialRow(bindings.DB, input.projectId, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  const name = input.name !== undefined ? normalizeCredentialName(input.name) : row.name;
  const apiBase = input.apiBase !== undefined ? normalizeApiBase(input.apiBase) : row.apiBase;
  const modelProtocol =
    input.modelProtocol === undefined
      ? (row.modelProtocol ?? null)
      : normalizeCredentialModelProtocol(row.vendorId, input.modelProtocol);
  if (row.modelProtocol !== undefined && row.modelProtocol !== null && modelProtocol === null) {
    throw new Error("An explicit model protocol cannot be cleared.");
  }
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
      ? await storeSecret(bindings.DB, bindings, {
          kind: VENDOR_API_KEY_SECRET_KIND,
          value: input.apiKey.trim(),
        })
      : row.apiKeySecretId;

  try {
    await getAppDatabase(bindings.DB)
      .update(vendorCredentialsTable)
      .set({
        apiBase,
        apiKeySecretId: nextSecretId,
        modelProtocol,
        models,
        name,
        updatedAt: currentTimestampMs(),
      })
      .where(
        and(
          eq(vendorCredentialsTable.id, input.id),
          eq(vendorCredentialsTable.projectId, input.projectId),
        ),
      )
      .run();
  } catch (error) {
    if (nextSecretId !== row.apiKeySecretId) {
      await deleteSecret(bindings.DB, nextSecretId).catch(ignorePromiseRejection);
    }
    throw error;
  }

  if (nextSecretId !== row.apiKeySecretId) {
    await deleteSecret(bindings.DB, row.apiKeySecretId);
  }

  const updated = await getProjectCredentialRow(bindings.DB, input.projectId, input.id);

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
  await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const row = await getProjectCredentialRow(bindings.DB, input.projectId, input.id);

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
          eq(vendorCredentialsTable.projectId, input.projectId),
          eq(vendorCredentialsTable.vendorId, row.vendorId),
        ),
      ),
    database
      .update(vendorCredentialsTable)
      .set({ isDefault: true, updatedAt: timestampMs })
      .where(
        and(
          eq(vendorCredentialsTable.id, input.id),
          eq(vendorCredentialsTable.projectId, input.projectId),
        ),
      ),
  ]);

  const updated = await getProjectCredentialRow(bindings.DB, input.projectId, input.id);

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
  await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const row = await getProjectCredentialRow(bindings.DB, input.projectId, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  await getAppDatabase(bindings.DB)
    .delete(vendorCredentialsTable)
    .where(
      and(
        eq(vendorCredentialsTable.id, input.id),
        eq(vendorCredentialsTable.projectId, input.projectId),
      ),
    )
    .run();
  await deleteSecret(bindings.DB, row.apiKeySecretId);

  // Deleting the default leaves the vendor with no default; promote the next
  // remaining credential so resolution stays deterministic.
  if (row.isDefault) {
    const nextDefault = await getProjectVendorCredentialRow(
      bindings.DB,
      input.projectId,
      row.vendorId,
    );

    if (nextDefault) {
      await getAppDatabase(bindings.DB)
        .update(vendorCredentialsTable)
        .set({ isDefault: true, updatedAt: currentTimestampMs() })
        .where(
          and(
            eq(vendorCredentialsTable.id, nextDefault.id),
            eq(vendorCredentialsTable.projectId, input.projectId),
          ),
        )
        .run();
    }
  }
}
