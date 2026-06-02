import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import type { SpaceRole, SpaceView } from "@mosoo/contracts/space";

import { isTruthy } from "../../shared/lib/truthiness";
export function canWriteToSpace(role: SpaceRole | null | undefined): boolean {
  return role === "edit" || role === "admin";
}

export function getSpaceManagementDisabledReason({
  space,
  viewerId,
  viewerOrganizationRole,
}: {
  space: SpaceView;
  viewerId: string | null | undefined;
  viewerOrganizationRole: OrganizationMemberRole | null;
}): string | null {
  if (space.canUpdateAcl || space.canDelete) {
    return null;
  }

  if (
    space.ownerId !== viewerId &&
    viewerOrganizationRole === "admin" &&
    space.creatorMembershipStatus === "active"
  ) {
    return "The creator is active. Admins can edit files, but cannot change access or delete this Space.";
  }

  return null;
}

export function canManageSpaceSettings(input: {
  space: SpaceView;
  viewerId: string | null | undefined;
  viewerOrganizationRole: OrganizationMemberRole | null;
}): boolean {
  if (!isTruthy(input.viewerId)) {
    return false;
  }

  return input.space.canUpdateAcl || input.space.canDelete;
}
