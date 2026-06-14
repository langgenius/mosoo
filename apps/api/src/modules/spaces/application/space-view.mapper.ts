import type { SpaceDetail, SpaceView } from "@mosoo/contracts/space";

import { toIsoString } from "../../../time";
import { rankToSpaceRole } from "../domain/space-access.policy";
import type { SpaceAccessRow } from "../domain/space-access.policy";

export function toSpaceView(row: SpaceAccessRow): SpaceView {
  const viewerAssetRole = rankToSpaceRole(row.role_rank);

  return {
    canDelete: true,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    name: row.name,
    ownerId: row.owner_account_id,
    appId: row.app_id,
    role: viewerAssetRole,
    storagePrefix: `sp/${row.id}/`,
    viewerAssetRole,
  };
}

export function toSpaceDetail(row: SpaceAccessRow): SpaceDetail {
  const viewerAssetRole = rankToSpaceRole(row.role_rank);

  return {
    canDelete: true,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    name: row.name,
    ownerId: row.owner_account_id,
    appId: row.app_id,
    viewerAssetRole,
  };
}
