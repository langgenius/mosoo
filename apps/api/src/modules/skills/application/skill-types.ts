import type { AccountId, ProjectId, SkillId, SkillSnapshotId } from "@mosoo/id";

export interface SkillRegistryRow {
  author: string;
  createdAt: number;
  currentSnapshotId: SkillSnapshotId;
  description: string;
  fileCount: number;
  forkedFromOwnerName: string | null;
  forkedFromSkillId: SkillId | null;
  forkedFromSkillName: string | null;
  id: SkillId;
  name: string;
  ownerId: AccountId;
  ownerName: string | null;
  updatedAt: number;
  projectId: ProjectId;
}
