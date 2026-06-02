import type { OrganizationJoinTarget } from "@mosoo/contracts/organization";
import type { OrganizationId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getOrganizationSummary,
  toOrganizationSummary,
} from "../domain/organization-access.policy";
import {
  isExpiredInvitation,
  toOrganizationAccessRequest,
  toOrganizationInvitation,
} from "./organization-access-contract-mapper";
import { getOrganizationJoinTargetSnapshot } from "./organization-access-record-store";

export async function getOrganizationJoinTarget(
  database: D1Database,
  viewer: AuthenticatedViewer | null,
  organizationId: OrganizationId,
): Promise<OrganizationJoinTarget> {
  const snapshot =
    viewer === null
      ? null
      : await getOrganizationJoinTargetSnapshot(database, {
          email: viewer.email,
          organizationId,
          viewerId: viewer.id,
        });
  const organization =
    viewer === null
      ? await getOrganizationSummary(database, organizationId)
      : snapshot === null
        ? null
        : toOrganizationSummary(snapshot.organization);

  if (organization === null) {
    throw new Error("Organization not found.");
  }

  const pendingInvitation =
    snapshot === null || snapshot.pendingInvitation === null
      ? null
      : toOrganizationInvitation(snapshot.pendingInvitation);
  const pendingRequest =
    snapshot === null || snapshot.pendingRequest === null
      ? null
      : toOrganizationAccessRequest(snapshot.pendingRequest);

  return {
    organization,
    organizationId: organization.id,
    organizationName: organization.name,
    pendingInvitation:
      pendingInvitation !== null && !isExpiredInvitation(pendingInvitation)
        ? pendingInvitation
        : null,
    pendingRequest,
    viewerIsAuthenticated: viewer !== null,
    viewerIsMember: organization.viewerRole !== null,
  };
}
