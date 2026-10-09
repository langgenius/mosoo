import type { SkillSummary } from "@mosoo/contracts/skill";

import { toIsoString } from "../../../time";
import type { SkillRegistryRow } from "./skill-types";

export function toSkillSummary(row: SkillRegistryRow): SkillSummary {
  const forkedFromOwnerName = row.forkedFromOwnerName;
  const forkedFromSkillId = row.forkedFromSkillId;
  const forkedFromSkillName = row.forkedFromSkillName;

  return {
    author: row.author,
    createdAt: toIsoString(row.createdAt),
    description: row.description,
    fileCount: row.fileCount,
    forkOrigin:
      forkedFromSkillId && forkedFromSkillName && forkedFromOwnerName
        ? {
            name: forkedFromSkillName,
            ownerName: forkedFromOwnerName,
            skillId: forkedFromSkillId,
          }
        : null,
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    ownerName: row.ownerName ?? row.author,
    projectId: row.projectId,
    snapshotId: row.currentSnapshotId,
    updatedAt: toIsoString(row.updatedAt),
  };
}
