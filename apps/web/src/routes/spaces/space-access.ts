import type { SpaceRole, SpaceView } from "@mosoo/contracts/space";

import { isTruthy } from "../../shared/lib/truthiness";
export function canWriteToSpace(role: SpaceRole | null | undefined): boolean {
  return role === "edit" || role === "admin";
}

export function getSpaceManagementDisabledReason({
  space,
  viewerId,
}: {
  space: SpaceView;
  viewerId: string | null | undefined;
}): string | null {
  if (isTruthy(viewerId) && space.canDelete) {
    return null;
  }

  return null;
}

export function canManageSpaceSettings(input: {
  space: SpaceView;
  viewerId: string | null | undefined;
}): boolean {
  if (!isTruthy(input.viewerId)) {
    return false;
  }

  return input.space.canDelete;
}
