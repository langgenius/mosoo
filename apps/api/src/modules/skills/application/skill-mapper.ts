import type { SkillSummary } from "@mosoo/contracts/skill";
import type { AccountId } from "@mosoo/id";

import { toIsoString } from "../../../time";
import type { SkillRegistryRow } from "./skill-types";

function toTimestampIsoString(value: number | string): string {
  const timestampMs = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(timestampMs)) {
    throw new TypeError("Skill timestamp is invalid.");
  }

  return toIsoString(timestampMs);
}

export function toSkillSummary(row: SkillRegistryRow, viewerId: AccountId): SkillSummary {
  const forkedFromOwnerName = row.forkedFromOwnerName;
  const forkedFromSkillId = row.forkedFromSkillId;
  const forkedFromSkillName = row.forkedFromSkillName;

  return {
    author: row.author,
    autoEnabled: row.autoEnabled === 1,
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
    organizationId: row.organizationId,
    ownerId: row.ownerId,
    ownerName: row.ownerName ?? row.author,
    role: row.ownerId === viewerId ? "owner" : "user",
    snapshotId: row.currentSnapshotId,
    sourceKind: row.sourceKind,
    updatedAt: toTimestampIsoString(row.updatedAt),
  };
}
