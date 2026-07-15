import type { SkillSnapshotEntry } from "@mosoo/contracts/skill";

export function countSkillFiles(entries: readonly SkillSnapshotEntry[]): number {
  let count = 0;

  for (const entry of entries) {
    if (entry.entryKind === "file") {
      count += 1;
    }
  }

  return count;
}
