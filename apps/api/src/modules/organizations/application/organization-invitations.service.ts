import type {
  AcceptOrganizationInvitationInput,
  CancelOrganizationInvitationInput,
  OrganizationInvitation,
  OrganizationSummary,
} from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import { organizationAccessRequestsTable, organizationInvitationsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, OrganizationInvitationId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import { sendOrganizationInvitationEmail } from "../../auth/application/auth-email.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { normalizeEmail } from "../../users/domain/email-address";
import { toOrganizationSummary } from "../domain/organization-access.policy";
import {
  isExpiredInvitation,
  toOrganizationInvitation,
} from "./organization-access-contract-mapper";
import {
  getOrganizationInviteMemberAdmission,
  getOrganizationInvitationAcceptanceRecordById,
  getOrganizationInvitationCancellationAdmission,
  getPendingOrganizationInvitationRecordByEmail,
  listPendingOrganizationInvitationRecordsForViewer,
  listPendingOrganizationInvitationRecordsForEmail,
} from "./organization-access-record-store";
import type {
  OrganizationInviteMemberAdmissionRow,
  OrganizationInvitationAcceptanceRow,
  OrganizationInvitationCancellationAdmissionRow,
  OrganizationInvitationListAdmissionRow,
  OrganizationInvitationRow,
} from "./organization-access-record-store";
import { grantOrganizationMembership } from "./organization-membership.service";

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function isPendingOrganizationInvitationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("organization_invitation_pending_email_idx") ||
    error.message.includes("organization_invitation.organization_id, organization_invitation.email")
  );
}

function toAcceptedInvitationOrganizationSummary(
  row: OrganizationInvitationAcceptanceRow,
): OrganizationSummary {
  return toOrganizationSummary({
    avatar_url: row.organization_avatar_url,
    created_at: row.organization_created_at,
    id: row.organization_id,
    join_policy: row.organization_join_policy,
    kind: row.organization_kind,
    name: row.organization_name,
    primary_domain: row.organization_primary_domain,
    slug: row.organization_slug,
    viewer_role: "member",
  });
}

function toListedOrganizationInvitation(
  row: OrganizationInvitationListAdmissionRow,
): OrganizationInvitation | null {
  if (row.id === null) {
    return null;
  }

  if (
    row.created_at === null ||
    row.email === null ||
    row.invited_by === null ||
    row.status === null ||
    row.updated_at === null
  ) {
    throw new Error("Invitation list row is incomplete.");
  }

  const invitationRow = {
    account_id: row.account_id,
    created_at: row.created_at,
    email: row.email,
    expires_at: row.expires_at,
    id: row.id,
    invited_by: row.invited_by,
    invited_by_name: row.invited_by_name,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    status: row.status,
    updated_at: row.updated_at,
  } satisfies OrganizationInvitationRow;

  return toOrganizationInvitation(invitationRow);
}

function toPendingOrganizationInvitation(input: {
  email: string;
  expiresAtMs: number;
  id: OrganizationInvitationId;
  invitedBy: AccountId;
  invitedByName: string;
  organizationId: OrganizationId;
  organizationName: string;
  timestampMs: number;
}): OrganizationInvitation {
  const invitationRow = {
    account_id: null,
    created_at: input.timestampMs,
    email: input.email,
    expires_at: input.expiresAtMs,
    id: input.id,
    invited_by: input.invitedBy,
    invited_by_name: input.invitedByName,
    organization_id: input.organizationId,
    organization_name: input.organizationName,
    status: "pending",
    updated_at: input.timestampMs,
  } satisfies OrganizationInvitationRow;

  return toOrganizationInvitation(invitationRow);
}

function requireExistingInvitation(
  admission: OrganizationInviteMemberAdmissionRow,
): OrganizationInvitation {
  const invitation = toListedOrganizationInvitation(admission);

  if (invitation === null) {
    throw new Error("Invitation could not be loaded.");
  }
  return invitation;
}

function toCancelledOrganizationInvitation(
  admission: OrganizationInvitationCancellationAdmissionRow,
  input: {
    accountId: AccountId;
    timestampMs: number;
  },
): OrganizationInvitation {
  return toOrganizationInvitation({
    ...admission,
    account_id: input.accountId,
    status: "cancelled",
    updated_at: input.timestampMs,
  });
}

export async function inviteOrganizationMember(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  email: string,
  organizationId: OrganizationId,
): Promise<OrganizationInvitation> {
  const database = bindings.DB;
  const normalizedEmail = normalizeEmail(email);

  const admission = await getOrganizationInviteMemberAdmission(database, {
    email: normalizedEmail,
    organizationId,
    viewerId: viewer.id,
  });

  if (!admission) {
    throw new Error("Organization not found.");
  }

  if (admission.viewer_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(admission.viewer_role, Permission.InvitationsCreate)) {
    throw forbiddenError();
  }

  if (admission.kind === "personal") {
    throw forbiddenError("Convert this Personal Org to collaborate with others.");
  }

  if (admission.existing_member_account_id !== null) {
    throw new Error("This user is already an organization member.");
  }

  if (admission.id !== null) {
    const existingInvitation = requireExistingInvitation(admission);
    await sendOrganizationInvitationEmail(bindings, {
      email: existingInvitation.email,
      expiresAt: existingInvitation.expiresAt,
      invitedByName: viewer.name,
      joinUrl: `${bindings.WEB_ORIGIN}/join/${existingInvitation.organizationId}`,
      organizationName: existingInvitation.organizationName,
    });
    return existingInvitation;
  }

  const timestampMs = currentTimestampMs();
  const expiresAtMs = timestampMs + INVITATION_TTL_MS;
  const invitationId: OrganizationInvitationId = createPlatformId();

  try {
    await getAppDatabase(database)
      .insert(organizationInvitationsTable)
      .values({
        accountId: null,
        createdAt: timestampMs,
        email: normalizedEmail,
        expiresAt: expiresAtMs,
        id: invitationId,
        invitedBy: viewer.id,
        organizationId: admission.organization_id,
        status: "pending",
        updatedAt: timestampMs,
      })
      .run();
  } catch (error) {
    if (!isPendingOrganizationInvitationConflict(error)) {
      throw error;
    }

    const concurrentInvitation = await getPendingOrganizationInvitationRecordByEmail(
      database,
      organizationId,
      normalizedEmail,
    );

    if (!concurrentInvitation) {
      throw error;
    }

    return toOrganizationInvitation(concurrentInvitation);
  }

  const invitation = toPendingOrganizationInvitation({
    email: normalizedEmail,
    expiresAtMs,
    id: invitationId,
    invitedBy: viewer.id,
    invitedByName: viewer.name,
    organizationId: admission.organization_id,
    organizationName: admission.organization_name,
    timestampMs,
  });

  await sendOrganizationInvitationEmail(bindings, {
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    invitedByName: viewer.name,
    joinUrl: `${bindings.WEB_ORIGIN}/join/${invitation.organizationId}`,
    organizationName: invitation.organizationName,
  });

  return invitation;
}

export async function listOrganizationInvitations(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<OrganizationInvitation[]> {
  const rows = await listPendingOrganizationInvitationRecordsForViewer(database, {
    organizationId,
    viewerId: viewer.id,
  });
  const firstRow = rows[0] ?? null;

  if (firstRow === null) {
    throw new Error("Organization not found.");
  }

  if (firstRow.viewer_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(firstRow.viewer_role, Permission.InvitationsList)) {
    throw forbiddenError();
  }

  return rows.flatMap((row) => {
    const invitation = toListedOrganizationInvitation(row);
    return invitation === null ? [] : [invitation];
  });
}

export async function listPendingOrganizationInvitations(
  database: D1Database,
  viewer: AuthenticatedViewer,
): Promise<OrganizationInvitation[]> {
  const rows = await listPendingOrganizationInvitationRecordsForEmail(
    database,
    viewer.email,
    viewer.id,
  );
  const invitations = rows.map(toOrganizationInvitation);
  return invitations.filter((invitation) => !isExpiredInvitation(invitation));
}

export async function acceptOrganizationInvitation(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AcceptOrganizationInvitationInput,
): Promise<OrganizationSummary> {
  const invitationRow = await getOrganizationInvitationAcceptanceRecordById(
    database,
    input.invitationId,
  );

  if (!invitationRow) {
    throw new Error("Invitation not found.");
  }

  const invitation = toOrganizationInvitation(invitationRow);

  if (normalizeEmail(invitation.email) !== normalizeEmail(viewer.email)) {
    throw new Error("Please use the invited email to continue.");
  }

  if (invitation.status !== "pending") {
    throw new Error("This invitation is no longer pending.");
  }

  if (isExpiredInvitation(invitation)) {
    await updateInvitationStatus(database, invitation.id, "expired", viewer.id);
    throw new Error("This invitation has expired.");
  }

  await grantOrganizationMembership(database, {
    accountId: viewer.id,
    makeActive: true,
    organizationKind: invitationRow.organization_kind,
    organizationId: invitation.organizationId,
    role: "member",
  });

  const timestampMs = currentTimestampMs();

  await runAppDatabaseBatch(database, (db) => [
    db
      .update(organizationInvitationsTable)
      .set({
        accountId: viewer.id,
        status: "accepted",
        updatedAt: timestampMs,
      })
      .where(eq(organizationInvitationsTable.id, invitation.id)),
    db
      .update(organizationAccessRequestsTable)
      .set({
        reviewedAt: timestampMs,
        reviewedBy: viewer.id,
        status: "cancelled",
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(organizationAccessRequestsTable.organizationId, invitation.organizationId),
          eq(organizationAccessRequestsTable.requestedByAccountId, viewer.id),
          eq(organizationAccessRequestsTable.status, "pending"),
        ),
      ),
  ]);

  return toAcceptedInvitationOrganizationSummary(invitationRow);
}

export async function cancelOrganizationInvitation(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CancelOrganizationInvitationInput,
): Promise<OrganizationInvitation> {
  const invitationRow = await getOrganizationInvitationCancellationAdmission(database, {
    invitationId: input.invitationId,
    viewerId: viewer.id,
  });

  if (!invitationRow) {
    throw new Error("Invitation not found.");
  }

  const invitation = toOrganizationInvitation(invitationRow);

  if (invitationRow.viewer_role === null) {
    throw new Error("Organization not found.");
  }

  if (invitationRow.viewer_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (invitationRow.viewer_role !== "owner" && invitation.invitedBy !== viewer.id) {
    throw forbiddenError();
  }

  if (invitation.status !== "pending") {
    throw new Error("This invitation is no longer pending.");
  }

  const timestampMs = currentTimestampMs();
  const cancelled =
    (await getAppDatabase(database)
      .update(organizationInvitationsTable)
      .set({
        accountId: viewer.id,
        status: "cancelled",
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(organizationInvitationsTable.id, invitation.id),
          eq(organizationInvitationsTable.status, "pending"),
        ),
      )
      .returning({ id: organizationInvitationsTable.id })
      .get()) ?? null;

  if (cancelled === null) {
    throw new Error("This invitation is no longer pending.");
  }

  const cancelledInvitation = toCancelledOrganizationInvitation(invitationRow, {
    accountId: viewer.id,
    timestampMs,
  });

  return cancelledInvitation;
}

async function updateInvitationStatus(
  database: D1Database,
  invitationId: OrganizationInvitationId,
  status: OrganizationInvitation["status"],
  accountId: AccountId | null,
): Promise<void> {
  await getAppDatabase(database)
    .update(organizationInvitationsTable)
    .set({
      accountId,
      status,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(organizationInvitationsTable.id, invitationId))
    .run();
}
