import type { SkillSnapshotEntry, SkillSnapshotRecord } from "@mosoo/contracts/skill";
import { skillSnapshotEntriesTable, skillSnapshotsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { OrganizationId, SkillSnapshotId } from "@mosoo/id";
import { createZipArchive, extractZipArchive, normalizeSkillEntries } from "@mosoo/skill-package";
import type { NormalizedSkillPackage, SkillPackageEntry } from "@mosoo/skill-package";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../time";
import { buildSkillBlobKey, readSkillBlobBytes, writeSkillBlob } from "./skill-blob-store";
import { loadNormalizedSkillPackage } from "./skill-package-source.service";
import { inferMimeType, SKILL_ARCHIVE_EXTRACT_OPTIONS, sha256Hex } from "./skill-package.shared";
import type { InspectSkillInput } from "./skill-package.shared";

export interface PublishedSkillSnapshot {
  entries: SkillSnapshotEntry[];
  snapshot: SkillSnapshotRecord;
}

export interface LoadedSkillSnapshotRow {
  author: string;
  blobKey: string;
  blobSha256: string;
  blobSize: number;
  createdAt: number;
  description: string;
  id: SkillSnapshotId;
  name: string;
  skillMarkdownPath: string;
  uncompressedSize: number;
  version: string | null;
  organizationId: OrganizationId;
}

export async function publishSkillSnapshot(
  bindings: ApiBindings,
  organizationId: OrganizationId,
  input: InspectSkillInput,
): Promise<PublishedSkillSnapshot> {
  const normalized = await loadNormalizedSkillPackage(input);
  const archiveBytes = createZipArchive(normalized.entries);
  const blobSha256 = await sha256Hex(archiveBytes);
  const existingSnapshot =
    (await getAppDatabase(bindings.DB)
      .select(skillSnapshotColumns())
      .from(skillSnapshotsTable)
      .where(
        and(
          eq(skillSnapshotsTable.organizationId, organizationId),
          eq(skillSnapshotsTable.blobSha256, blobSha256),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (existingSnapshot) {
    return {
      entries: await listSkillSnapshotEntries(bindings.DB, existingSnapshot.id),
      snapshot: toSkillSnapshotRecord(existingSnapshot),
    };
  }

  const timestampMs = currentTimestampMs();
  const snapshotId = createPlatformId<SkillSnapshotId>();
  const blobKey = buildSkillBlobKey(organizationId, blobSha256);
  const entries = await Promise.all(normalized.entries.map(toSkillSnapshotEntry));
  const snapshotAuthor = normalized.frontmatter.author ?? normalized.frontmatter.name;
  const uncompressedSize = calculateUncompressedSize(normalized);

  await writeSkillBlob(bindings, {
    blobKey,
    bytes: archiveBytes,
  });

  await getAppDatabase(bindings.DB)
    .insert(skillSnapshotsTable)
    .values({
      author: snapshotAuthor,
      blobKey,
      blobSha256,
      blobSize: archiveBytes.byteLength,
      createdAt: timestampMs,
      description: normalized.frontmatter.description,
      id: snapshotId,
      name: normalized.frontmatter.name,
      organizationId,
      skillMarkdownPath: normalized.skillMarkdownPath,
      uncompressedSize,
      version: normalized.frontmatter.version ?? null,
    })
    .run();

  if (entries.length > 0) {
    await getAppDatabase(bindings.DB)
      .insert(skillSnapshotEntriesTable)
      .values(
        entries.map((entry) => ({
          entryKind: entry.entryKind,
          isExecutable: entry.isExecutable,
          mimeType: entry.mimeType,
          path: entry.path,
          sha256: entry.sha256,
          size: entry.size,
          snapshotId,
        })),
      )
      .run();
  }

  return {
    entries,
    snapshot: {
      archiveFormat: "zip",
      author: snapshotAuthor,
      blobKey,
      blobSha256,
      blobSize: archiveBytes.byteLength,
      compression: "deflate",
      createdAt: toIsoString(timestampMs),
      description: normalized.frontmatter.description,
      id: snapshotId,
      name: normalized.frontmatter.name,
      skillMarkdownPath: normalized.skillMarkdownPath,
      uncompressedSize,
      version: normalized.frontmatter.version ?? null,
    },
  };
}

export async function listSkillSnapshotEntries(
  database: D1Database,
  snapshotId: SkillSnapshotId,
): Promise<SkillSnapshotEntry[]> {
  return getAppDatabase(database)
    .select({
      entryKind: skillSnapshotEntriesTable.entryKind,
      isExecutable: skillSnapshotEntriesTable.isExecutable,
      mimeType: skillSnapshotEntriesTable.mimeType,
      path: skillSnapshotEntriesTable.path,
      sha256: skillSnapshotEntriesTable.sha256,
      size: skillSnapshotEntriesTable.size,
    })
    .from(skillSnapshotEntriesTable)
    .where(eq(skillSnapshotEntriesTable.snapshotId, snapshotId))
    .orderBy(asc(skillSnapshotEntriesTable.path))
    .all();
}

export async function readSkillMarkdownFromSnapshot(
  bindings: ApiBindings,
  snapshotId: SkillSnapshotId,
): Promise<string> {
  const snapshot = await getSkillSnapshot(bindings.DB, snapshotId);

  if (snapshot === null) {
    throw new Error("Skill snapshot not found.");
  }

  const normalized = await readNormalizedSkillPackageFromSnapshot(bindings, snapshot);
  const skillMarkdownEntry = normalized.entries.find((entry) => entry.path === "SKILL.md");

  if (skillMarkdownEntry?.entryKind !== "file") {
    throw new Error(`Snapshot ${snapshotId} is missing SKILL.md.`);
  }

  return new TextDecoder().decode(skillMarkdownEntry.body);
}

export async function readSkillPackageBytesFromSnapshot(
  bindings: ApiBindings,
  snapshotId: SkillSnapshotId,
): Promise<Uint8Array> {
  const snapshot = await getSkillSnapshot(bindings.DB, snapshotId);

  if (snapshot === null) {
    throw new Error("Skill snapshot not found.");
  }

  return readSkillBlobBytes(bindings, snapshot.blobKey);
}

export async function getSkillSnapshot(
  database: D1Database,
  snapshotId: SkillSnapshotId,
): Promise<LoadedSkillSnapshotRow | null> {
  const snapshot =
    (await getAppDatabase(database)
      .select(skillSnapshotColumns())
      .from(skillSnapshotsTable)
      .where(eq(skillSnapshotsTable.id, snapshotId))
      .limit(1)
      .get()) ?? null;

  return snapshot;
}

export async function listSkillSnapshotsByIds(
  database: D1Database,
  snapshotIds: readonly SkillSnapshotId[],
): Promise<Map<SkillSnapshotId, LoadedSkillSnapshotRow>> {
  const uniqueSnapshotIds = [...new Set(snapshotIds)];

  if (uniqueSnapshotIds.length === 0) {
    return new Map();
  }

  const rows = await getAppDatabase(database)
    .select(skillSnapshotColumns())
    .from(skillSnapshotsTable)
    .where(inArray(skillSnapshotsTable.id, uniqueSnapshotIds))
    .all();

  return new Map(rows.map((row) => [row.id, row]));
}

function skillSnapshotColumns() {
  return {
    author: skillSnapshotsTable.author,
    blobKey: skillSnapshotsTable.blobKey,
    blobSha256: skillSnapshotsTable.blobSha256,
    blobSize: skillSnapshotsTable.blobSize,
    createdAt: skillSnapshotsTable.createdAt,
    description: skillSnapshotsTable.description,
    id: skillSnapshotsTable.id,
    name: skillSnapshotsTable.name,
    organizationId: skillSnapshotsTable.organizationId,
    skillMarkdownPath: skillSnapshotsTable.skillMarkdownPath,
    uncompressedSize: skillSnapshotsTable.uncompressedSize,
    version: skillSnapshotsTable.version,
  };
}

export function toSkillSnapshotRecord(row: LoadedSkillSnapshotRow): SkillSnapshotRecord {
  return {
    archiveFormat: "zip",
    author: row.author,
    blobKey: row.blobKey,
    blobSha256: row.blobSha256,
    blobSize: row.blobSize,
    compression: "deflate",
    createdAt: toIsoString(row.createdAt),
    description: row.description,
    id: row.id,
    name: row.name,
    skillMarkdownPath: row.skillMarkdownPath,
    uncompressedSize: row.uncompressedSize,
    version: row.version,
  };
}

function calculateUncompressedSize(normalized: NormalizedSkillPackage): number {
  return normalized.entries.reduce((totalBytes, entry) => totalBytes + entry.body.byteLength, 0);
}

async function readNormalizedSkillPackageFromSnapshot(
  bindings: ApiBindings,
  snapshot: LoadedSkillSnapshotRow,
): Promise<NormalizedSkillPackage> {
  const archiveBytes = await readSkillBlobBytes(bindings, snapshot.blobKey);
  const entries = extractZipArchive(archiveBytes, SKILL_ARCHIVE_EXTRACT_OPTIONS);

  return normalizeSkillEntries(
    Object.fromEntries(
      entries.map((entry: SkillPackageEntry) => [
        entry.path,
        {
          body: entry.body,
          entryKind: entry.entryKind,
          isExecutable: entry.isExecutable,
        },
      ]),
    ),
  );
}

async function toSkillSnapshotEntry(entry: SkillPackageEntry): Promise<SkillSnapshotEntry> {
  return {
    entryKind: entry.entryKind,
    isExecutable: entry.isExecutable,
    mimeType: inferMimeType(entry.path),
    path: entry.path,
    sha256: entry.entryKind === "file" ? await sha256Hex(entry.body) : null,
    size: entry.body.byteLength,
  };
}
