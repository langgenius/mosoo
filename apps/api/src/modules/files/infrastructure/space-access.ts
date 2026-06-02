import type { SpaceRole } from "@mosoo/contracts/space";
import type { AccountId, OrganizationId, SpaceId } from "@mosoo/id";

import { isApiError } from "../../../platform/errors";
import { ensureSpaceAccess as ensureDomainSpaceAccess } from "../../spaces/domain/space-access.policy";
import { createFileForbiddenError, createFileNotFoundError } from "./file-errors";

export interface SpaceAccessRow {
  created_at: number;
  id: SpaceId;
  name: string;
  owner_account_id: AccountId;
  role_rank: number;
  visibility: "private" | "shared" | "organization";
  organization_id: OrganizationId;
}

export async function ensureSpaceAccess(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
  requiredRole: SpaceRole,
): Promise<SpaceAccessRow> {
  try {
    const row = await ensureDomainSpaceAccess(database, viewerId, spaceId, requiredRole);
    return {
      created_at: row.created_at,
      id: row.id,
      name: row.name,
      organization_id: row.organization_id,
      owner_account_id: row.owner_account_id,
      role_rank: row.role_rank,
      visibility: row.visibility,
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
