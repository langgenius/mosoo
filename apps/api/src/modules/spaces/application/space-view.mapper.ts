import type { SpaceDetail, SpaceView } from "@mosoo/contracts/space";

import { toIsoString } from "../../../time";
import type { SpaceAccessRow } from "../domain/space-access.policy";

export function toSpaceView(row: SpaceAccessRow): SpaceView {
  return {
    canDelete: true,
    canManage: true,
    canRead: true,
    canWrite: true,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    name: row.name,
    ownerId: row.owner_account_id,
    appId: row.app_id,
    storagePrefix: `sp/${row.id}/`,
  };
}

export function toSpaceDetail(row: SpaceAccessRow): SpaceDetail {
  return {
    canDelete: true,
    canManage: true,
    canRead: true,
    canWrite: true,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    name: row.name,
    ownerId: row.owner_account_id,
    appId: row.app_id,
  };
}
