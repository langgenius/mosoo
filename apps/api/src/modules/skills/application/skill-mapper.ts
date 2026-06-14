import type { SkillSummary } from "@mosoo/contracts/skill";

import { toIsoString } from "../../../time";
import type { SkillRegistryRow } from "./skill-types";

function toTimestampIsoString(value: number | string): string {
  const timestampMs = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(timestampMs)) {
    throw new TypeError("Skill timestamp is invalid.");
  }

  return toIsoString(timestampMs);
}

export function toSkillSummary(row: SkillRegistryRow): SkillSummary {
  const forkedFromOwnerName = row.forkedFromOwnerName;
  const forkedFromSkillId = row.forkedFromSkillId;
  const forkedFromSkillName = row.forkedFromSkillName;

  return {
    author: row.author,
    createdAt: toTimestampIsoString(row.createdAt),
    description: row.description,
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
    appId: row.appId,
    snapshotId: row.currentSnapshotId,
    sourceKind: row.sourceKind,
    updatedAt: toTimestampIsoString(row.updatedAt),
  };
}
