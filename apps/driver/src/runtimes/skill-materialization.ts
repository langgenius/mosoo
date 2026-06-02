import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { DriverExecutionSpec, DriverResolvedSkill } from "@mosoo/driver-protocol";
import type { Logger } from "@mosoo/observability";
import { extractZipArchive } from "@mosoo/skill-package";
import type { SkillArchiveExtractOptions, SkillPackageEntry } from "@mosoo/skill-package";

export interface MaterializedSkill {
  readonly mountPath: string;
  readonly skillId: string;
  readonly skillMarkdownPath: string;
  readonly skillName: string;
  readonly snapshotId: string;
}

const MAX_SKILL_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const SKILL_ARCHIVE_EXTRACT_OPTIONS: SkillArchiveExtractOptions = {
  maxEntryCount: 256,
  maxFileBytes: MAX_SKILL_ENTRY_BYTES,
  maxTotalFileBytes: MAX_SKILL_UNCOMPRESSED_BYTES,
};

interface SkillMaterializationMarker {
  readonly blobSha256: string;
  readonly snapshotId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSkillMaterializationMarker(value: unknown): SkillMaterializationMarker | null {
  if (!isRecord(value) || typeof value["blobSha256"] !== "string") {
    return null;
  }

  if (typeof value["snapshotId"] !== "string") {
    return null;
  }

  return {
    blobSha256: value["blobSha256"],
    snapshotId: value["snapshotId"],
  };
}

function enforceSkillMountPath(sessionOrganizationPath: string, mountPath: string): void {
  const allowedRoot = resolve(sessionOrganizationPath, ".mosoo", "skill");
  const resolvedMountPath = resolve(mountPath);
  const relativeMountPath = relative(allowedRoot, resolvedMountPath);

  if (
    relativeMountPath.length === 0 ||
    relativeMountPath.startsWith("..") ||
    relativeMountPath.includes("/")
  ) {
    throw new Error(`Resolved skill mount path is outside the allowed root: ${mountPath}.`);
  }
}

export async function materializeResolvedSkills(
  execution: DriverExecutionSpec,
  logger: Logger,
): Promise<MaterializedSkill[]> {
  const materializedSkills = await Promise.all(
    execution.skills.map((skill) => materializeResolvedSkill(execution, logger, skill)),
  );

  return materializedSkills.filter((skill): skill is MaterializedSkill => skill !== null);
}

async function readSkillMaterializationMarker(
  markerPath: string,
): Promise<SkillMaterializationMarker | null> {
  try {
    return parseSkillMaterializationMarker(JSON.parse(await readFile(markerPath, "utf8")));
  } catch {
    return null;
  }
}

async function materializeResolvedSkill(
  execution: DriverExecutionSpec,
  logger: Logger,
  skill: DriverResolvedSkill,
): Promise<MaterializedSkill | null> {
  const snapshotId = skill.snapshotId;

  if (
    skill.resolutionMode === "tombstone" ||
    snapshotId === undefined ||
    snapshotId === null ||
    snapshotId.length === 0
  ) {
    logger.info("driver.skill.skipped", {
      reason: skill.warningCode ?? "skill.tombstone",
      skillId: skill.skillId,
      skillName: skill.skillName,
    });
    return null;
  }

  enforceSkillMountPath(execution.session.context.sessionOrganizationPath, skill.mountPath);
  const skillMarkdownPath = join(skill.mountPath, "SKILL.md");
  const markerPath = join(skill.mountPath, ".mosoo-skill-cache.json");
  const marker = await readSkillMaterializationMarker(markerPath);

  if (
    marker?.blobSha256 === skill.blobSha256 &&
    marker.snapshotId === snapshotId &&
    (await readFile(skillMarkdownPath, "utf8").then(
      () => true,
      () => false,
    ))
  ) {
    logger.info("driver.skill.materialization.cache_hit", {
      skillId: skill.skillId,
      skillName: skill.skillName,
      snapshotId,
    });
    return {
      mountPath: skill.mountPath,
      skillId: skill.skillId,
      skillMarkdownPath,
      skillName: skill.skillName,
      snapshotId,
    };
  }

  await rm(skill.mountPath, { force: true, recursive: true });
  await mkdir(skill.mountPath, { recursive: true });
  const compressed = await downloadSkillPackage(skill);
  const actualSha256 = createHash("sha256").update(compressed).digest("hex");

  if (actualSha256 !== skill.blobSha256) {
    throw new Error(`Skill blob checksum mismatch for ${skill.skillId}.`);
  }

  const entries = extractZipArchive(compressed, SKILL_ARCHIVE_EXTRACT_OPTIONS);
  if (!entries.some((entry) => entry.entryKind === "file" && entry.path === "SKILL.md")) {
    throw new Error(`Skill package for ${skill.skillId} does not contain SKILL.md.`);
  }
  await Promise.all(
    entries.map(async (entry) => {
      await materializeSkillEntry(skill.mountPath, entry);
    }),
  );
  await writeFile(
    markerPath,
    JSON.stringify({
      blobSha256: skill.blobSha256,
      snapshotId,
    }),
    "utf8",
  );

  return {
    mountPath: skill.mountPath,
    skillId: skill.skillId,
    skillMarkdownPath,
    skillName: skill.skillName,
    snapshotId,
  };
}

async function materializeSkillEntry(mountPath: string, entry: SkillPackageEntry): Promise<void> {
  const absolutePath = join(mountPath, entry.path);

  if (entry.entryKind === "directory") {
    await mkdir(absolutePath, { recursive: true });
    return;
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, entry.body);

  if (entry.isExecutable) {
    await chmod(absolutePath, 0o755);
  }
}

async function downloadSkillPackage(skill: DriverResolvedSkill): Promise<Uint8Array> {
  const response = await fetch(skill.downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download skill package for ${skill.skillId}: ${response.status}.`);
  }

  return new Uint8Array(await response.arrayBuffer());
}
