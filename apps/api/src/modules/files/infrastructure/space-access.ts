import type { SpaceRole } from "@mosoo/contracts/space";
import type { AccountId, AppId, SpaceId } from "@mosoo/id";

import { isApiError } from "../../../platform/errors";
import {
  ensureSpaceAccess as ensureDomainSpaceAccess,
  ensureSpaceAccessBySpaceId as ensureDomainSpaceAccessBySpaceId,
} from "../../spaces/domain/space-access.policy";
import { createFileForbiddenError, createFileNotFoundError } from "./file-errors";

export interface SpaceAccessRow {
  created_at: number;
  id: SpaceId;
  name: string;
  owner_account_id: AccountId;
  app_id: AppId;
  role_rank: number;
}

export async function ensureSpaceAccess(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  spaceId: SpaceId,
  requiredRole: SpaceRole,
): Promise<SpaceAccessRow> {
  try {
    const row = await ensureDomainSpaceAccess(database, viewerId, appId, spaceId, requiredRole);
    return {
      created_at: row.created_at,
      id: row.id,
      name: row.name,
      owner_account_id: row.owner_account_id,
      app_id: row.app_id,
      role_rank: row.role_rank,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Space not found.") {
      throw createFileNotFoundError("Space not found.");
    }

    if (isApiError(error) && error.status === 403) {
      throw createFileForbiddenError(`Insufficient space ${requiredRole} permission.`);
    }

    throw error;
  }
}

export async function ensureSpaceAccessBySpaceId(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
  requiredRole: SpaceRole,
): Promise<SpaceAccessRow> {
  try {
    const row = await ensureDomainSpaceAccessBySpaceId(database, viewerId, spaceId, requiredRole);
    return {
      created_at: row.created_at,
      id: row.id,
      name: row.name,
      owner_account_id: row.owner_account_id,
      app_id: row.app_id,
      role_rank: row.role_rank,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Space not found.") {
      throw createFileNotFoundError("Space not found.");
    }

    if (isApiError(error) && error.status === 403) {
      throw createFileForbiddenError(`Insufficient space ${requiredRole} permission.`);
    }

    throw error;
  }
}
