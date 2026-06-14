import type { SpaceView } from "@mosoo/contracts/space";

export function filterSpaces(spaces: SpaceView[], search: string): SpaceView[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return spaces;
  }

  return spaces.filter((space) => space.name.toLowerCase().includes(query));
}
