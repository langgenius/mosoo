import type {
  CreateVendorCredentialInput,
  DeleteVendorCredentialInput,
  UpdateVendorCredentialInput,
  VendorCredential,
} from "@mosoo/contracts/vendor-credential";
import { vendorCredentialsTable } from "@mosoo/db";
import { ignorePromiseRejection } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, VendorCredentialId } from "@mosoo/id";
import { getVendor } from "@mosoo/runtime-catalog";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureOrganizationAdmin,
  ensureOrganizationMembership,
} from "../../organizations/domain/organization-access.policy";
import {
  enforceApiBaseAllowed,
  enforceCredentialModelShape,
  normalizeApiBase,
  normalizeCredentialModels,
  normalizeCredentialName,
  serializeCredentialModels,
} from "./vendor-credential-validation";
import {
  credentialScope,
  parseCredentialModels,
  toVendorCredentialWithSecret,
} from "./vendor-credential.mapper";
import { getPersonalCredentialPolicyError, toCredentialPolicy } from "./vendor-credential.policy";
import {
  getCredentialPolicyRow,
  getCredentialRow,
  hasDefaultCompanyCredential,
  setCompanyCredentialAsDefault,
  setPersonalCredentialAsPreferred,
} from "./vendor-credential.repository";
import {
  deleteVendorCredentialSecret,
  readVendorCredentialSecret,
  storeVendorCredentialSecret,
} from "./vendor-credential.secret-resolution";
import type { VendorCredentialRow } from "./vendor-credential.types";
async function loadPolicy(database: D1Database, organizationId: OrganizationId) {
  return toCredentialPolicy(organizationId, await getCredentialPolicyRow(database, organizationId));
}

function toSecretOwnerCommand(input: { actorAccountId: AccountId; row: VendorCredentialRow }) {
  return {
    actorAccountId: input.actorAccountId,
    credentialId: input.row.id,
    organizationId: input.row.organizationId,
    ownerAccountId: input.row.ownerUserId,
    providerId: input.row.vendorId,
    scope: credentialScope(input.row),
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
  viewer: AuthenticatedViewer,
  row: VendorCredentialRow,
  policy: Awaited<ReturnType<typeof loadPolicy>>,
): Promise<VendorCredential> {
  const secret = await readVendorCredentialSecret(bindings, {
    actorAccountId: viewer.id,
    credential: row,
    organizationId: row.organizationId,
    providerId: row.vendorId,
    purpose: "credential_display_api_key",
  });

  if (secret.status === "denied") {
    throw new Error("Vendor credential secret is unavailable.");
  }

  return toVendorCredentialWithSecret(row, policy, secret.apiKey);
}

export async function createVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateVendorCredentialInput,
): Promise<VendorCredential> {
  const scope = input.scope ?? "company";
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

  if (scope === "company") {
    await ensureOrganizationAdmin(bindings.DB, viewer.id, input.organizationId);
  } else {
    await ensureOrganizationMembership(bindings.DB, viewer.id, input.organizationId);
    const policy = await loadPolicy(bindings.DB, input.organizationId);
    const policyError = getPersonalCredentialPolicyError(policy, input.vendorId);

    if (isTruthy(policyError)) {
      throw new Error(policyError);
    }
  }

  const id = createPlatformId<VendorCredentialId>();
  const timestampMs = currentTimestampMs();
  const ownerUserId = scope === "personal" ? viewer.id : null;
  const shouldDefault =
    scope === "company" &&
    (input.isDefault === true ||
      !(await hasDefaultCompanyCredential(bindings.DB, input.organizationId, input.vendorId)));
  const shouldPreferred = scope === "personal" && input.isPreferred !== false;
  const secretId = await storeVendorCredentialSecret(bindings, {
    actorAccountId: viewer.id,
    apiKey,
    credentialId: id,
    organizationId: input.organizationId,
    ownerAccountId: ownerUserId,
    providerId: input.vendorId,
    purpose: "credential_create_api_key",
    scope,
  });

  try {
    if (shouldDefault) {
      await getAppDatabase(bindings.DB)
        .update(vendorCredentialsTable)
        .set({ isDefault: false, updatedAt: timestampMs })
        .where(
          and(
            eq(vendorCredentialsTable.organizationId, input.organizationId),
            eq(vendorCredentialsTable.vendorId, input.vendorId),
            isNull(vendorCredentialsTable.ownerAccountId),
          ),
        )
        .run();
    }

    if (shouldPreferred && ownerUserId !== null) {
      await getAppDatabase(bindings.DB)
        .update(vendorCredentialsTable)
        .set({ isPreferred: false, updatedAt: timestampMs })
        .where(
          and(
            eq(vendorCredentialsTable.organizationId, input.organizationId),
            eq(vendorCredentialsTable.vendorId, input.vendorId),
            eq(vendorCredentialsTable.ownerAccountId, ownerUserId),
          ),
        )
        .run();
    }

    await getAppDatabase(bindings.DB)
      .insert(vendorCredentialsTable)
      .values({
        apiBase,
        apiKeySecretId: secretId,
        createdAt: timestampMs,
        id,
        isDefault: shouldDefault,
        isPreferred: shouldPreferred,
        models: sql`${serializeCredentialModels(models)}`,
        name,
        organizationId: input.organizationId,
        ownerAccountId: ownerUserId,
        updatedAt: timestampMs,
        vendorId: input.vendorId,
      })
      .run();
  } catch (error) {
    await deleteVendorCredentialSecret(bindings.DB, {
      actorAccountId: viewer.id,
      credentialId: id,
      organizationId: input.organizationId,
      ownerAccountId: ownerUserId,
      providerId: input.vendorId,
      purpose: "credential_create_rollback",
      scope,
      secretId,
    }).catch(ignorePromiseRejection);
    throw error;
  }

  const row = await getCredentialRow(bindings.DB, id);

  if (!row) {
    throw new Error("Vendor credential could not be loaded.");
  }

  const policy = await loadPolicy(bindings.DB, input.organizationId);
  const credential = await toVisibleVendorCredential(bindings, viewer, row, policy);
  return credential;
}

export async function updateVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: UpdateVendorCredentialInput,
): Promise<VendorCredential> {
  const row = await getCredentialRow(bindings.DB, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  const scope = credentialScope(row);

  if (scope === "company") {
    await ensureOrganizationAdmin(bindings.DB, viewer.id, row.organizationId);
  } else if (row.ownerUserId !== viewer.id) {
    throw new Error("Vendor credential not found.");
  } else {
    await ensureOrganizationMembership(bindings.DB, viewer.id, row.organizationId);

    const requiresByokPolicy =
      input.isPreferred === true ||
      input.name !== undefined ||
      input.apiKey !== undefined ||
      input.apiBase !== undefined ||
      input.models !== undefined;
    const policy = requiresByokPolicy ? await loadPolicy(bindings.DB, row.organizationId) : null;
    const policyError = policy ? getPersonalCredentialPolicyError(policy, row.vendorId) : null;

    if (isTruthy(policyError)) {
      throw new Error(policyError);
    }
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
          ...toSecretOwnerCommand({ actorAccountId: viewer.id, row }),
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
        models: sql`${serializeCredentialModels(models)}`,
        name,
        updatedAt: currentTimestampMs(),
      })
      .where(eq(vendorCredentialsTable.id, input.id))
      .run();

    if (scope === "company" && input.isDefault === true) {
      await setCompanyCredentialAsDefault(bindings.DB, row);
    } else if (scope === "company" && input.isDefault === false && row.isDefault === 1) {
      await getAppDatabase(bindings.DB)
        .update(vendorCredentialsTable)
        .set({ isDefault: false, updatedAt: currentTimestampMs() })
        .where(eq(vendorCredentialsTable.id, row.id))
        .run();
    }

    if (scope === "personal" && input.isPreferred === true) {
      await setPersonalCredentialAsPreferred(bindings.DB, row);
    } else if (scope === "personal" && input.isPreferred === false && row.isPreferred === 1) {
      await getAppDatabase(bindings.DB)
        .update(vendorCredentialsTable)
        .set({ isPreferred: false, updatedAt: currentTimestampMs() })
        .where(eq(vendorCredentialsTable.id, row.id))
        .run();
    }
  } catch (error) {
    if (nextSecretId !== row.apiKeySecretId) {
      await deleteVendorCredentialSecret(bindings.DB, {
        ...toSecretOwnerCommand({ actorAccountId: viewer.id, row }),
        purpose: "credential_update_rollback",
        secretId: nextSecretId,
      }).catch(ignorePromiseRejection);
    }
    throw error;
  }

  if (nextSecretId !== row.apiKeySecretId) {
    ensureVendorCredentialSecretDeleted(
      await deleteVendorCredentialSecret(bindings.DB, {
        ...toSecretOwnerCommand({ actorAccountId: viewer.id, row }),
        purpose: "credential_update_replaced",
        secretId: row.apiKeySecretId,
      }),
    );
  }

  const updated = await getCredentialRow(bindings.DB, input.id);

  if (!updated) {
    throw new Error("Vendor credential could not be loaded.");
  }

  const policy = await loadPolicy(bindings.DB, row.organizationId);
  const credential = await toVisibleVendorCredential(bindings, viewer, updated, policy);

  return credential;
}

export async function deleteVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: DeleteVendorCredentialInput,
): Promise<void> {
  const row = await getCredentialRow(bindings.DB, input.id);

  if (!row) {
    throw new Error("Vendor credential not found.");
  }

  const scope = credentialScope(row);

  if (scope === "company") {
    await ensureOrganizationAdmin(bindings.DB, viewer.id, row.organizationId);
  } else if (row.ownerUserId !== viewer.id) {
    throw new Error("Vendor credential not found.");
  } else {
    await ensureOrganizationMembership(bindings.DB, viewer.id, row.organizationId);
  }

  await getAppDatabase(bindings.DB)
    .delete(vendorCredentialsTable)
    .where(eq(vendorCredentialsTable.id, input.id))
    .run();
  ensureVendorCredentialSecretDeleted(
    await deleteVendorCredentialSecret(bindings.DB, {
      ...toSecretOwnerCommand({ actorAccountId: viewer.id, row }),
      purpose: "credential_delete",
      secretId: row.apiKeySecretId,
    }),
  );
}
