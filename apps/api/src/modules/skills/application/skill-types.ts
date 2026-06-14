import type { SkillSummary } from "@mosoo/contracts/skill";
import type { AccountId, OrganizationId, AppId, SkillId, SkillSnapshotId } from "@mosoo/id";

export interface SkillRegistryRow {
  author: string;
  createdAt: number;
  currentSnapshotId: SkillSnapshotId;
  description: string;
  forkedFromOwnerName: string | null;
  forkedFromSkillId: SkillId | null;
  forkedFromSkillName: string | null;
  id: SkillId;
  name: string;
  ownerId: AccountId;
  ownerName: string | null;
  sourceKind: SkillSummary["sourceKind"];
  updatedAt: number;
  organizationId: OrganizationId;
  appId: AppId;
}
