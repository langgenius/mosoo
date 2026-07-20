import type { AccountId, AppId, SkillId, SkillSnapshotId } from "../id/id.contract";

export type SkillSourceKind = "official" | "user";
export type SkillSnapshotEntryKind = "directory" | "file";
export type SkillResolutionMode = "auto" | "explicit" | "tombstone";
export type SkillMaterializationStatus = "failed" | "pending" | "ready" | "skipped";
export type SkillsShCatalogView = "all-time" | "hot" | "trending";
export type SkillsShSourceType = "github" | "well-known";

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

export interface SkillSummary {
  author: string;
  createdAt: string;
  description: string;
  fileCount: number;
  forkOrigin: SkillForkOrigin | null;
  id: SkillId;
  name: string;
  ownerId: AccountId;
  ownerName: string;
  appId: AppId;
  snapshotId: SkillSnapshotId;
  sourceKind: SkillSourceKind;
  updatedAt: string;
}

export interface SkillDetail extends SkillSummary {
  currentSnapshot: SkillSnapshotRecord;
  entries: SkillSnapshotEntry[];
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

export interface CreateSkillForkInput {
  appId: AppId;
  skillId: SkillId;
}

export interface SkillsShCatalogSkill {
  id: string;
  installUrl: string | null;
  installs: number;
  isDuplicate: boolean;
  isOfficial: boolean;
  name: string;
  slug: string;
  source: string;
  sourceType: SkillsShSourceType;
  url: string;
}

export interface SkillsShCatalogResult {
  authConfigured: boolean;
  count: number;
  hasMore: boolean;
  page: number;
  perPage: number;
  query: string | null;
  skills: SkillsShCatalogSkill[];
  source: "api" | "public-page";
  total: number | null;
  view: SkillsShCatalogView;
}

export interface InstallSkillsShSkillInput {
  appId: AppId;
  id: string;
  installUrl?: string | null;
  slug: string;
}
