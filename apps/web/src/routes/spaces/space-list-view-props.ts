import type { SpaceView } from "@mosoo/contracts/space";

export interface SpaceListViewProps {
  canManageSpace: (space: SpaceView) => boolean;
  getManageDisabledReason: (space: SpaceView) => string | null;
  onOpenSettings: (spaceId: string) => void;
  onSelectSpace: (spaceId: string) => void;
  spaces: SpaceView[];
}
