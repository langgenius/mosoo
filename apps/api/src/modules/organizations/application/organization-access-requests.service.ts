import type {
  OrganizationAccessRequest,
  RequestOrganizationAccessInput,
  RequestOrganizationInvitationInput,
  ReviewOrganizationAccessRequestInput,
} from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import { organizationAccessRequestsTable, organizationInvitationsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { OrganizationAccessRequestId, OrganizationId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, notFoundError, validationError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import { sendOrganizationAccessDecisionEmail } from "../../auth/application/auth-email.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { normalizeEmail } from "../../users/domain/email-address";
import { getOrganizationEmailDomain } from "../domain/organization-domain-match";
import {
  toListedOrganizationAccessRequest,
  toOrganizationAccessRequest,
  toPendingOrganizationAccessRequest,
} from "./organization-access-contract-mapper";
import {
  getOrganizationAccessRequestReviewAdmission,
  getOrganizationAccessSubmissionAdmission,
  getOrganizationInvitationRequestAdmission,
  getPendingOrganizationAccessRequestRecordByUser,
  listPendingOrganizationAccessRequestRecordsForViewer,
} from "./organization-access-record-store";
import { grantOrganizationMembership } from "./organization-membership.service";

function isPendingOrganizationAccessRequestConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("organization_access_request_pending_account_idx") ||
    error.message.includes(
      "organization_access_request.organization_id, organization_access_request.requested_by_account_id",
    )
  );
}

export async function requestOrganizationAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RequestOrganizationAccessInput,
): Promise<OrganizationAccessRequest> {
  const normalizedViewerEmail = normalizeEmail(viewer.email);
  const domain = getOrganizationEmailDomain(viewer.email);
  const admission = await getOrganizationAccessSubmissionAdmission(database, {
    domain,
    email: normalizedViewerEmail,
    organizationId: input.organizationId,
    viewerId: viewer.id,
  });

  if (!admission) {
    throw notFoundError("Organization not found.");
  }

  if (admission.active_membership_account_id !== null) {
    throw validationError("You already have access to this organization.");
  }

  if (admission.pending_invitation_id !== null) {
    throw validationError("You already have an invitation to this organization.");
  }

  if (
    admission.pending_request_id !== null &&
    admission.pending_request_created_at !== null &&
    admission.pending_request_requester_email !== null &&
    admission.pending_request_updated_at !== null
  ) {
    return toPendingOrganizationAccessRequest({
      createdAtMs: admission.pending_request_created_at,
      id: admission.pending_request_id,
      organizationId: admission.organization_id,
      organizationName: admission.organization_name,
      referrerAccountId: admission.pending_request_referrer_account_id,
      referrerName: admission.pending_request_referrer_name,
      requestedByAccountId: viewer.id,
      requesterEmail: admission.pending_request_requester_email,
      requesterName: viewer.name,
      updatedAtMs: admission.pending_request_updated_at,
    });
  }

  if (admission.kind === "personal") {
    throw forbiddenError("Personal Orgs do not accept access requests.");
  }

  if (admission.join_policy !== "invite_only") {
    throw forbiddenError("This organization does not accept access requests.");
  }

  if (admission.primary_domain !== domain && admission.active_domain_id === null) {
    throw forbiddenError("Your email domain does not match this organization.");
  }

  const timestampMs = currentTimestampMs();
  const requestId: OrganizationAccessRequestId = createPlatformId();

  try {
    await getAppDatabase(database)
      .insert(organizationAccessRequestsTable)
      .values({
        createdAt: timestampMs,
        id: requestId,
        organizationId: input.organizationId,
        referrerAccountId: null,
        requestedByAccountId: viewer.id,
        requesterEmail: normalizedViewerEmail,
        reviewedAt: null,
        reviewedBy: null,
        status: "pending",
        updatedAt: timestampMs,
      })
      .run();
  } catch (error) {
    if (!isPendingOrganizationAccessRequestConflict(error)) {
      throw error;
    }

    const concurrentRequest = await getPendingOrganizationAccessRequestRecordByUser(
      database,
      input.organizationId,
      viewer.id,
    );

    if (!concurrentRequest) {
      throw error;
    }

    return toOrganizationAccessRequest(concurrentRequest);
  }

  const created = toPendingOrganizationAccessRequest({
    createdAtMs: timestampMs,
    id: requestId,
    organizationId: admission.organization_id,
    organizationName: admission.organization_name,
    referrerAccountId: null,
    referrerName: null,
    requestedByAccountId: viewer.id,
    requesterEmail: normalizedViewerEmail,
    requesterName: viewer.name,
  });

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.memberShare,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      kind: "access_request_create",
      requestId: created.id,
      status: "pending",
    },
    organizationId: created.organizationId,
    outcome: "success",
    resourceDisplay: created.requesterEmail,
    resourceId: created.requestedByAccountId,
    resourceType: AUDIT_RESOURCE.member,
  });

  return created;
}

export async function requestOrganizationInvitation(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RequestOrganizationInvitationInput,
): Promise<OrganizationAccessRequest> {
  const normalizedEmail = normalizeEmail(input.email);

  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const admission = await getOrganizationInvitationRequestAdmission(database, {
    email: normalizedEmail,
    organizationId: input.organizationId,
    viewerId: viewer.id,
  });

  if (!admission) {
    throw new Error("Organization not found.");
  }

  if (admission.viewer_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(admission.viewer_role, Permission.InvitationsRequest)) {
    throw forbiddenError();
  }

  if (admission.kind === "personal") {
    throw forbiddenError("Convert this Personal Org to collaborate with others.");
  }

  if (admission.invitee_id === null || admission.invitee_name === null) {
    throw new Error(
      "Member-initiated invites are only available for users who already have a Mosoo account. Ask an organization admin to send a fresh email invitation.",
    );
  }

  const inviteeId = admission.invitee_id;
  const inviteeName = admission.invitee_name;

  if (inviteeId === viewer.id) {
    throw new Error("You can't request an invitation for yourself.");
  }

  if (admission.invitee_active_membership_account_id !== null) {
    throw new Error("This user is already an organization member.");
  }

  if (admission.pending_invitation_id !== null) {
    throw new Error("This user already has a pending invitation to the organization.");
  }

  if (
    admission.pending_request_id !== null &&
    admission.pending_request_created_at !== null &&
    admission.pending_request_requester_email !== null &&
    admission.pending_request_updated_at !== null
  ) {
    return toPendingOrganizationAccessRequest({
      createdAtMs: admission.pending_request_created_at,
      id: admission.pending_request_id,
      organizationId: admission.organization_id,
      organizationName: admission.organization_name,
      referrerAccountId: admission.pending_request_referrer_account_id,
      referrerName: admission.pending_request_referrer_name,
      requestedByAccountId: inviteeId,
      requesterEmail: admission.pending_request_requester_email,
      requesterName: inviteeName,
      updatedAtMs: admission.pending_request_updated_at,
    });
  }

  const timestampMs = currentTimestampMs();
  const requestId: OrganizationAccessRequestId = createPlatformId();

  try {
    await getAppDatabase(database)
      .insert(organizationAccessRequestsTable)
      .values({
        createdAt: timestampMs,
        id: requestId,
        organizationId: admission.organization_id,
        referrerAccountId: viewer.id,
        requestedByAccountId: inviteeId,
        requesterEmail: normalizedEmail,
        reviewedAt: null,
        reviewedBy: null,
        status: "pending",
        updatedAt: timestampMs,
      })
      .run();
  } catch (error) {
    if (!isPendingOrganizationAccessRequestConflict(error)) {
      throw error;
    }

    const concurrentRequest = await getPendingOrganizationAccessRequestRecordByUser(
      database,
      admission.organization_id,
      inviteeId,
    );

    if (!concurrentRequest) {
      throw error;
    }

    return toOrganizationAccessRequest(concurrentRequest);
  }

  const created = toPendingOrganizationAccessRequest({
    createdAtMs: timestampMs,
    id: requestId,
    organizationId: admission.organization_id,
    organizationName: admission.organization_name,
    referrerAccountId: viewer.id,
    referrerName: viewer.name,
    requestedByAccountId: inviteeId,
    requesterEmail: normalizedEmail,
    requesterName: inviteeName,
  });

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.memberShare,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      kind: "invitation_request_create",
      requestId,
      status: "pending",
    },
    organizationId: admission.organization_id,
    outcome: "success",
    resourceDisplay: inviteeName || normalizedEmail,
    resourceId: inviteeId,
    resourceType: AUDIT_RESOURCE.member,
  });

  return created;
}

export async function listOrganizationAccessRequests(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<OrganizationAccessRequest[]> {
  const rows = await listPendingOrganizationAccessRequestRecordsForViewer(database, {
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

  if (!can(firstRow.viewer_role, Permission.AccessRequestsList)) {
    throw forbiddenError();
  }

  return rows.flatMap((row) => {
    const request = toListedOrganizationAccessRequest(row);
    return request === null ? [] : [request];
  });
}

export async function reviewOrganizationAccessRequest(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ReviewOrganizationAccessRequestInput,
): Promise<OrganizationAccessRequest> {
  const database = bindings.DB;
  const requestRow = await getOrganizationAccessRequestReviewAdmission(database, {
    requestId: input.requestId,
    viewerId: viewer.id,
  });

  if (!requestRow) {
    throw new Error("Access request not found.");
  }

  const request = toOrganizationAccessRequest(requestRow);

  if (requestRow.viewer_role === null) {
    throw new Error("Organization not found.");
  }

  if (requestRow.viewer_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(requestRow.viewer_role, Permission.AccessRequestsReview)) {
    throw forbiddenError();
  }

  if (request.status !== "pending") {
    throw new Error("This access request has already been reviewed.");
  }

  const timestampMs = currentTimestampMs();
  const nextStatus = input.decision === "approve" ? "approved" : "rejected";

  const updated =
    (await getAppDatabase(database)
      .update(organizationAccessRequestsTable)
      .set({
        reviewedAt: timestampMs,
        reviewedBy: viewer.id,
        status: nextStatus,
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(organizationAccessRequestsTable.id, request.id),
          eq(organizationAccessRequestsTable.status, "pending"),
        ),
      )
      .returning({ id: organizationAccessRequestsTable.id })
      .get()) ?? null;

  if (updated === null) {
    throw new Error("This access request has already been reviewed.");
  }

  const reviewed = toOrganizationAccessRequest({
    ...requestRow,
    reviewed_at: timestampMs,
    reviewed_by: viewer.id,
    reviewed_by_name: viewer.name,
    status: nextStatus,
    updated_at: timestampMs,
  });

  if (input.decision === "approve") {
    await grantOrganizationMembership(database, {
      accountId: reviewed.requestedByAccountId,
      organizationKind: requestRow.organization_kind,
      organizationId: reviewed.organizationId,
      role: "member",
    });

    await getAppDatabase(database)
      .update(organizationInvitationsTable)
      .set({
        status: "cancelled",
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(organizationInvitationsTable.organizationId, reviewed.organizationId),
          eq(organizationInvitationsTable.email, reviewed.requesterEmail),
          eq(organizationInvitationsTable.status, "pending"),
        ),
      )
      .run();

    await appendAuditEvent(database, {
      action: AUDIT_ACTION.memberCreate,
      ...resolveViewerAuditActor(viewer),
      metadata: {
        kind: "access_request_approve",
        requestId: reviewed.id,
        role: "member",
        status: "active",
      },
      organizationId: reviewed.organizationId,
      outcome: "success",
      resourceDisplay: reviewed.requesterEmail,
      resourceId: reviewed.requestedByAccountId,
      resourceType: AUDIT_RESOURCE.member,
    });
  } else {
    await appendAuditEvent(database, {
      action: AUDIT_ACTION.memberUpdate,
      ...resolveViewerAuditActor(viewer),
      metadata: {
        decision: input.decision,
        kind: "access_request_reject",
        requestId: reviewed.id,
        status: "rejected",
      },
      organizationId: reviewed.organizationId,
      outcome: "success",
      resourceDisplay: reviewed.requesterEmail,
      resourceId: reviewed.requestedByAccountId,
      resourceType: AUDIT_RESOURCE.member,
    });
  }

  try {
    await sendOrganizationAccessDecisionEmail(bindings, {
      decision: input.decision === "approve" ? "approved" : "rejected",
      email: reviewed.requesterEmail,
      organizationName: reviewed.organizationName,
    });
  } catch (error) {
    logWarn("organization.access_request.decision_email_failed", {
      decision: input.decision,
      error: error instanceof Error ? error.message : String(error),
      organizationId: reviewed.organizationId,
      requestId: reviewed.id,
    });
  }

  return reviewed;
}
