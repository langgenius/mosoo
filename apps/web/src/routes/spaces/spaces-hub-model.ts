import type { SpaceView } from "@mosoo/contracts/space";

import type { Scope } from "@/shared/ui/scope-tabs";

export interface SpaceScopeGroups {
  ownedSpaces: SpaceView[];
  organizationSpaces: SpaceView[];
}

export function groupSpacesByScope(
  spaces: SpaceView[],
  userId: string | undefined,
): SpaceScopeGroups {
  return {
    organizationSpaces: spaces.filter((space) => space.ownerId !== userId),
    ownedSpaces: spaces.filter((space) => space.ownerId === userId),
  };
}

export function getSpacesForScope(groups: SpaceScopeGroups, scope: Scope): SpaceView[] {
  return scope === "organization" ? groups.organizationSpaces : groups.ownedSpaces;
}

export function filterSpaces(spaces: SpaceView[], search: string): SpaceView[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return spaces;
  }

  return spaces.filter((space) => space.name.toLowerCase().includes(query));
}
