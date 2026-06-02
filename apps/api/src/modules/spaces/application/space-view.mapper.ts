import type { SpaceDetail, SpaceView, SpaceVisibility } from "@mosoo/contracts/space";
import type { AccountId } from "@mosoo/id";

import { toIsoString } from "../../../time";
import { canManageSpaceAclOrDelete, rankToSpaceRole } from "../domain/space-access.policy";
import type { SpaceAccessRow } from "../domain/space-access.policy";

export function toSpaceView(row: SpaceAccessRow, viewerId: AccountId): SpaceView {
  const viewerAssetRole = rankToSpaceRole(row.role_rank);
  const canManageAclOrDelete = canManageSpaceAclOrDelete({
    creatorMembershipStatus: row.creator_membership_status,
    row,
    viewerId,
    viewerOrganizationRole: row.viewer_organization_role,
  });

  return {
    canDelete: canManageAclOrDelete,
    canUpdateAcl: canManageAclOrDelete,
    createdAt: toIsoString(row.created_at),
    creatorMembershipStatus: row.creator_membership_status,
    id: row.id,
    isSharedWithViewer: isSharedWithViewer(row, viewerId),
    name: row.name,
    ownerId: row.owner_account_id,
    role: viewerAssetRole,
    storagePrefix: `sp/${row.id}/`,
    viewerAssetRole,
    visibility: normalizeSpaceVisibility(row.visibility),
  };
}

export function toSpaceDetail(row: SpaceAccessRow, viewerId: AccountId): SpaceDetail {
  const viewerAssetRole = rankToSpaceRole(row.role_rank);
  const canManageAclOrDelete = canManageSpaceAclOrDelete({
    creatorMembershipStatus: row.creator_membership_status,
    row,
    viewerId,
    viewerOrganizationRole: row.viewer_organization_role,
  });

  return {
    canDelete: canManageAclOrDelete,
    canUpdateAcl: canManageAclOrDelete,
    createdAt: toIsoString(row.created_at),
    creatorMembershipStatus: row.creator_membership_status,
    id: row.id,
    isSharedWithViewer: isSharedWithViewer(row, viewerId),
    name: row.name,
    organizationId: row.organization_id,
    ownerId: row.owner_account_id,
    viewerAssetRole,
    visibility: normalizeSpaceVisibility(row.visibility),
  };
}

function normalizeSpaceVisibility(visibility: SpaceAccessRow["visibility"]): SpaceVisibility {
  return visibility === "organization" ? "shared" : visibility;
}

function isSharedWithViewer(row: SpaceAccessRow, viewerId: AccountId): boolean {
  return row.owner_account_id !== viewerId && row.acl_role_rank > 0;
}
