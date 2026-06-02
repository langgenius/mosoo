import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import type {
  CredentialPolicy,
  UpdateCredentialPolicyInput,
  VendorCredential,
  VendorCredentialCapability,
} from "@mosoo/contracts/vendor-credential";
import { organizationMembersTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { PUBLIC_VENDORS } from "@mosoo/runtime-catalog";
import { and, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import {
  isProviderAllowed,
  serializeAllowedProviderIds,
  toCredentialPolicy,
} from "./vendor-credential.policy";
import { listVisibleVendorCredentialRows } from "./vendor-credential.repository";
import { readVendorCredentialSecret } from "./vendor-credential.secret-resolution";
import type { VendorCredentialRow } from "./vendor-credential.types";

interface CredentialPolicyAccess {
  policy: CredentialPolicy;
  role: OrganizationMemberRole;
}

async function readCredentialPolicyAccess(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<CredentialPolicyAccess> {
  const row =
    (await getAppDatabase(database)
      .select({
        byokAllowedProviders: organizationsTable.byokAllowedProviders,
        byokEnabled: sql<number>`${organizationsTable.byokEnabled}`,
        disabledAt: organizationMembersTable.disabledAt,
        role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .where(
        and(
          eq(organizationMembersTable.accountId, viewerId),
          eq(organizationMembersTable.organizationId, organizationId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("Organization not found.");
  }

  if (row.disabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  return {
    policy: toCredentialPolicy(organizationId, {
      byokAllowedProviders: row.byokAllowedProviders,
      byokEnabled: row.byokEnabled,
    }),
    role: row.role,
  };
}

async function readCredentialPolicyAdminAccess(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<CredentialPolicyAccess> {
  const access = await readCredentialPolicyAccess(database, viewerId, organizationId);

  if (!can(access.role, Permission.ProvidersCompanyManage)) {
    throw forbiddenError();
  }

  return access;
}

export async function getCredentialPolicy(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<CredentialPolicy> {
  return (await readCredentialPolicyAdminAccess(database, viewer.id, organizationId)).policy;
}

export async function listVendorCredentialCapabilities(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<VendorCredentialCapability[]> {
  const { policy } = await readCredentialPolicyAccess(database, viewer.id, organizationId);

  return PUBLIC_VENDORS.map((vendor) => {
    const providerAllowed = isProviderAllowed(policy, vendor.vendorId);

    return {
      organizationId,
      personalCredentialAllowed: policy.byokEnabled && providerAllowed,
      providerAllowed,
      vendorId: vendor.vendorId,
    };
  });
}

export async function updateCredentialPolicy(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateCredentialPolicyInput,
): Promise<CredentialPolicy> {
  await readCredentialPolicyAdminAccess(database, viewer.id, input.organizationId);
  const serializedProviderIds = serializeAllowedProviderIds(input.allowedProviderIds);

  await getAppDatabase(database)
    .update(organizationsTable)
    .set({
      byokAllowedProviders: serializedProviderIds,
      byokEnabled: input.byokEnabled,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(organizationsTable.id, input.organizationId))
    .run();

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.orgSettingsUpdate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      byokEnabled: input.byokEnabled,
      kind: "credential_policy",
    },
    organizationId: input.organizationId,
    outcome: "success",
    resourceDisplay: "Credential policy",
    resourceId: input.organizationId,
    resourceType: AUDIT_RESOURCE.orgSettings,
  });

  return toCredentialPolicy(input.organizationId, {
    byokAllowedProviders: serializedProviderIds,
    byokEnabled: input.byokEnabled ? 1 : 0,
  });
}

export async function listVendorCredentials(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<VendorCredential[]> {
  const { policy, role } = await readCredentialPolicyAccess(bindings.DB, viewer.id, organizationId);
  const rows = await listVisibleVendorCredentialRows(bindings.DB, viewer.id, organizationId);
  const visibleRows = can(role, Permission.ProvidersCompanyManage)
    ? rows
    : rows.filter((row) => isProviderAllowed(policy, row.vendorId));

  return Promise.all(
    visibleRows.map((row) =>
      toVisibleVendorCredential(bindings, viewer, organizationId, row, policy),
    ),
  );
}

async function toVisibleVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
  row: VendorCredentialRow,
  policy: CredentialPolicy,
): Promise<VendorCredential> {
  const secret = await readVendorCredentialSecret(bindings, {
    actorAccountId: viewer.id,
    credential: row,
    organizationId,
    providerId: row.vendorId,
    purpose: "credential_display_api_key",
  });

  if (secret.status === "denied") {
    throw new Error("Vendor credential secret is unavailable.");
  }

  return toVendorCredentialWithSecret(row, policy, secret.apiKey);
}
