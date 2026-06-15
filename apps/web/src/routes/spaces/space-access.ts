import type { SpaceView } from "@mosoo/contracts/space";

import { isTruthy } from "../../shared/lib/truthiness";

export function getSpaceManagementDisabledReason({
  space,
  viewerId,
}: {
  space: SpaceView;
  viewerId: string | null | undefined;
}): string | null {
  if (isTruthy(viewerId) && space.canManage) {
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

  return input.space.canManage;
}
