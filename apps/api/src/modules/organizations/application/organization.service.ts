import type {
  ConvertPersonalOrganizationInput,
  CreateOrganizationInput,
  OrganizationKind,
  OrganizationMemberRole,
  OrganizationSummary,
  SetActiveOrganizationInput,
  UpdateOrganizationPrimaryDomainInput,
  UpdateOrganizationProfileInput,
} from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import { organizationMembersTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { errorMessageChainIncludes, forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getPublicEmailDomain } from "../../auth/domain/email-domain";
import { recordLastActiveOrganization } from "../../users/application/account-organization-context.service";
import { deriveOrgName } from "../../users/domain/user-account.policy";
import {
  ensureOrganizationPermission,
  getOrganizationSummaryForActiveMember,
  organizationSummaryColumns,
  toOrganizationSummary,
  toOrganizationSummaryWithViewerRole,
} from "../domain/organization-access.policy";
import type { OrganizationSummaryDataRow } from "../domain/organization-access.policy";
import { normalizeOrganizationAvatarUrl } from "../domain/organization-avatar";
import {
  enforceValidOrganizationKind,
  normalizeOrganizationKind,
} from "../domain/organization-kind.policy";
import { normalizeOrganizationName } from "../domain/organization-name";
import { provisionOrganizationWithOwner } from "./organization-provisioning.service";
function normalizePrimaryDomain(domain: string | null): string | null {
  const normalized = domain?.trim().toLowerCase().replace(/^@/u, "") ?? "";

  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(normalized)) {
    throw new Error("Enter a valid email domain.");
  }

  if (getPublicEmailDomain(normalized)) {
    throw new Error("Public email domains cannot be used for organization discovery.");
  }

  return normalized;
}

function derivePersonalOrganizationName(viewer: AuthenticatedViewer): string {
  return `${viewer.name}'s Sandbox`;
}

function isOrganizationPrimaryDomainConflict(error: unknown): boolean {
  return errorMessageChainIncludes(error, [
    "organization_primary_domain_idx",
    "organization.primary_domain",
  ]);
}

interface OrganizationSummaryAdmissionRow extends OrganizationSummaryDataRow {
  disabled_at: number | null;
  viewer_role: OrganizationMemberRole;
}

async function loadOrganizationSummaryAdmission(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<OrganizationSummaryAdmissionRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...organizationSummaryColumns(),
        disabled_at: organizationMembersTable.disabledAt,
        viewer_role: organizationMembersTable.role,
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

  if (!row) {
    throw new Error("Organization not found.");
  }

  if (row.disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  return row;
}

async function admitOrganizationSummaryPermission(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
  permission: Permission,
): Promise<OrganizationSummaryAdmissionRow> {
  const row = await loadOrganizationSummaryAdmission(database, viewerId, organizationId);

  if (!can(row.viewer_role, permission)) {
    throw forbiddenError();
  }

  return row;
}

async function hasActiveOrganizationMembership(
  database: D1Database,
  accountId: AccountId,
): Promise<boolean> {
  const membership =
    (await getAppDatabase(database)
      .select({ accountId: organizationMembersTable.accountId })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.accountId, accountId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return Boolean(membership);
}

async function admitPersonalOrganizationConversion(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<OrganizationSummaryAdmissionRow> {
  const row = await loadOrganizationSummaryAdmission(database, viewerId, organizationId);

  if (row.viewer_role !== "owner") {
    throw forbiddenError("Only the Personal Org owner can convert it.");
  }

  if (row.kind !== "personal") {
    throw new Error("Only Personal Orgs can be converted.");
  }

  return row;
}

async function resolveCreateOrganizationKind(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateOrganizationInput,
): Promise<OrganizationKind> {
  const requestedKind = input.kind === undefined ? null : normalizeOrganizationKind(input.kind);
  if (requestedKind !== null) {
    enforceValidOrganizationKind(requestedKind);
  }

  const domain = viewer.email.split("@")[1]?.toLowerCase() ?? "";
  const isPublicEmail = getPublicEmailDomain(domain);

  if (requestedKind === "personal") {
    return "personal";
  }

  if (requestedKind === "team" && !isPublicEmail) {
    return "team";
  }

  const hasMembership = await hasActiveOrganizationMembership(database, viewer.id);
  if (!hasMembership) {
    if (isPublicEmail) {
      return "personal";
    }

    if (requestedKind === null) {
      throw new Error("Choose whether to create an organization or a Personal Org.");
    }
  }

  return requestedKind ?? "team";
}

async function updateOrganizationPrimaryDomainRow(
  database: D1Database,
  input: {
    normalizedDomain: string | null;
    organizationId: OrganizationId;
    timestampMs: number;
  },
) {
  try {
    return (
      (await getAppDatabase(database)
        .update(organizationsTable)
        .set({
          primaryDomain: input.normalizedDomain,
          updatedAt: input.timestampMs,
        })
        .where(eq(organizationsTable.id, input.organizationId))
        .returning(organizationSummaryColumns())
        .get()) ?? null
    );
  } catch (error) {
    if (isOrganizationPrimaryDomainConflict(error)) {
      throw new Error("This domain is already claimed by another organization.", {
        cause: error,
      });
    }

    throw error;
  }
}

function deriveNewOrganizationName(
  viewer: AuthenticatedViewer,
  input: CreateOrganizationInput,
  kind: OrganizationKind,
): string {
  if (input.name !== undefined) {
    return normalizeOrganizationName(input.name);
  }

  return kind === "personal"
    ? derivePersonalOrganizationName(viewer)
    : deriveOrgName(viewer.email, viewer.name);
}

export async function createOrganization(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateOrganizationInput,
): Promise<OrganizationSummary> {
  const kind = await resolveCreateOrganizationKind(database, viewer, input);

  return provisionOrganizationWithOwner(database, viewer, {
    kind,
    makeActive: true,
    name: deriveNewOrganizationName(viewer, input, kind),
  });
}

export async function setActiveOrganization(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SetActiveOrganizationInput,
): Promise<OrganizationSummary> {
  const summary = await getOrganizationSummaryForActiveMember(
    database,
    input.organizationId,
    viewer.id,
  );
  await recordLastActiveOrganization(database, viewer.id, input.organizationId);
  return summary;
}

export async function updateOrganizationPrimaryDomain(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateOrganizationPrimaryDomainInput,
): Promise<OrganizationSummary> {
  const admitted = await admitOrganizationSummaryPermission(
    database,
    viewer.id,
    input.organizationId,
    Permission.OrgSetPrimaryDomain,
  );
  const normalizedDomain = normalizePrimaryDomain(input.domain);
  const timestampMs = currentTimestampMs();

  if (admitted.kind === "personal" && Boolean(normalizedDomain)) {
    if (!(input.convertPersonal === true)) {
      throw new Error("Claiming a domain requires converting this Personal Org first.");
    }

    if (admitted.viewer_role !== "owner") {
      throw forbiddenError("Only the Personal Org owner can convert it.");
    }

    try {
      await getAppDatabase(database)
        .update(organizationsTable)
        .set({
          creatorAccountId: viewer.id,
          joinPolicy: "auto",
          primaryDomain: normalizedDomain,
          updatedAt: timestampMs,
        })
        .where(eq(organizationsTable.id, input.organizationId))
        .run();
    } catch (error) {
      if (isOrganizationPrimaryDomainConflict(error)) {
        throw new Error("This domain is already claimed by another organization.", {
          cause: error,
        });
      }

      throw error;
    }

    return toOrganizationSummary({
      ...admitted,
      join_policy: "auto",
      kind: "team",
      primary_domain: normalizedDomain,
    });
  }

  const updated = await updateOrganizationPrimaryDomainRow(database, {
    normalizedDomain,
    organizationId: input.organizationId,
    timestampMs,
  });

  if (updated === null) {
    throw new Error("Organization not found.");
  }

  return toOrganizationSummaryWithViewerRole(updated, admitted.viewer_role);
}

export async function updateOrganizationProfile(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateOrganizationProfileInput,
): Promise<OrganizationSummary> {
  const membership = await ensureOrganizationPermission(
    database,
    viewer.id,
    input.organizationId,
    Permission.OrgUpdateProfile,
  );

  const nameProvided = input.name !== undefined;
  const avatarProvided = Object.prototype.hasOwnProperty.call(input, "avatarUrl");

  if (!nameProvided && !avatarProvided) {
    throw new Error("Nothing to update.");
  }

  const updates: { avatarUrl?: string | null; name?: string; updatedAt: number } = {
    updatedAt: currentTimestampMs(),
  };

  if (nameProvided) {
    updates.name = normalizeOrganizationName(input.name as string);
  }

  if (avatarProvided) {
    updates.avatarUrl = normalizeOrganizationAvatarUrl(input.avatarUrl);
  }

  const updated =
    (await getAppDatabase(database)
      .update(organizationsTable)
      .set(updates)
      .where(eq(organizationsTable.id, input.organizationId))
      .returning(organizationSummaryColumns())
      .get()) ?? null;

  if (updated === null) {
    throw new Error("Organization not found.");
  }

  return toOrganizationSummaryWithViewerRole(updated, membership.role);
}

export async function convertPersonalOrganization(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: ConvertPersonalOrganizationInput,
): Promise<OrganizationSummary> {
  const admitted = await admitPersonalOrganizationConversion(
    database,
    viewer.id,
    input.organizationId,
  );

  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .update(organizationsTable)
    .set({
      creatorAccountId: viewer.id,
      joinPolicy: "auto",
      updatedAt: timestampMs,
    })
    .where(eq(organizationsTable.id, input.organizationId))
    .run();

  return toOrganizationSummary({
    ...admitted,
    join_policy: "auto",
    kind: "team",
  });
}
