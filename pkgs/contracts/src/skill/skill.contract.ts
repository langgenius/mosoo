import type { AccountId, OrganizationId, SkillId, SkillSnapshotId } from "../id/id.contract";

export type SkillSourceKind = "official" | "user";
export type SkillRegistryRole = "owner" | "user";
export type SkillShareTargetKind = "user" | "organization";
export type SkillSnapshotEntryKind = "directory" | "file";
export type SkillResolutionMode = "auto" | "explicit" | "tombstone";
export type SkillMaterializationStatus = "failed" | "pending" | "ready" | "skipped";
export type SkillShareTargetId = AccountId | OrganizationId;

export interface SkillForkOrigin {
  name: string;
  ownerName: string;
  skillId: SkillId;
}

export interface SkillSnapshotEntry {
  entryKind: SkillSnapshotEntryKind;
  isExecutable: boolean;
  mimeType: string | null;
  path: string;
  sha256: string | null;
  size: number;
}

export interface SkillSnapshotRecord {
  archiveFormat: string;
  author: string;
  blobKey: string;
  blobSha256: string;
  blobSize: number;
  compression: string;
  createdAt: string;
  description: string;
  id: SkillSnapshotId;
  name: string;
  skillMarkdownPath: string;
  uncompressedSize: number;
  version: string | null;
}

export interface SkillShareTarget {
  createdAt: string;
  email: string | null;
  id: SkillShareTargetId;
  kind: SkillShareTargetKind;
  name: string | null;
}

export interface SkillSummary {
  author: string;
  autoEnabled: boolean;
  createdAt: string;
  description: string;
  forkOrigin: SkillForkOrigin | null;
  id: SkillId;
  name: string;
  ownerId: AccountId;
  ownerName: string;
  role: SkillRegistryRole;
  snapshotId: SkillSnapshotId;
  sourceKind: SkillSourceKind;
  updatedAt: string;
  organizationId: OrganizationId;
}

export interface SkillDetail extends SkillSummary {
  currentSnapshot: SkillSnapshotRecord;
  entries: SkillSnapshotEntry[];
  shareTargets: SkillShareTarget[];
}

export interface SkillInspectResult {
  entries: SkillSnapshotEntry[];
  frontmatter: {
    author?: string;
    description: string;
    name: string;
    version?: string;
  };
  normalizedFileName: string;
  skillMarkdownPath: string;
  warnings: string[];
}

export interface SkillAutoPreference {
  autoEnabled: boolean;
  skillId: SkillId;
}

export interface ResolvedRunSkill {
  archiveFormat: "zip";
  blobSha256: string;
  compression: "deflate";
  downloadUrl: string;
  materializationStatus: SkillMaterializationStatus;
  mountPath: string;
  resolutionMode: SkillResolutionMode;
  skillId: SkillId;
  skillName: string;
  snapshotId: SkillSnapshotId | null;
  warningCode: string | null;
}

export interface SetSkillAutoEnabledInput {
  autoEnabled: boolean;
  skillId: SkillId;
}

export interface CreateSkillForkInput {
  skillId: SkillId;
}

export interface ShareSkillWithUserInput {
  email: string;
  skillId: SkillId;
}

export interface ShareSkillWithOrganizationInput {
  skillId: SkillId;
}

export interface UnshareSkillTargetInput {
  skillId: SkillId;
  targetId: SkillShareTargetId;
  targetKind: SkillShareTargetKind;
}
