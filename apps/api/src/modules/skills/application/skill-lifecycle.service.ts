import type { CreateSkillForkInput, SkillSummary } from "@mosoo/contracts/skill";
import { skillsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ProjectId, SkillId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSkillAccess, ensureSkillDestructiveManager } from "./skill-access.service";
import { getSkillSummary } from "./skill-query.service";

export async function createSkillFork(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateSkillForkInput,
): Promise<SkillSummary> {
  const viewerId = viewer.id;
  const source = await ensureSkillAccess(database, viewerId, input.projectId, input.skillId);
  const timestampMs = currentTimestampMs();
  const skillId = createPlatformId<SkillId>();
  const forkName = await allocateCopyName(database, source.projectId, source.name);

  await getAppDatabase(database)
    .insert(skillsTable)
    .values({
      author: source.author,
      createdAt: timestampMs,
      currentSnapshotId: source.currentSnapshotId,
      description: source.description,
      forkedFromOwnerName: source.ownerName ?? source.author,
      forkedFromSkillId: source.id,
      forkedFromSkillName: source.name,
      id: skillId,
      name: forkName,
      ownerAccountId: viewerId,
      projectId: source.projectId,
      sourceKind: "user",
      updatedAt: timestampMs,
      version: null,
    })
    .run();

  return getSkillSummary(database, viewer, input.projectId, skillId);
}

export async function deleteOwnedSkill(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<void> {
  await ensureSkillDestructiveManager(database, viewer.id, projectId, skillId);

  await getAppDatabase(database)
    .delete(skillsTable)
    .where(and(eq(skillsTable.id, skillId), eq(skillsTable.projectId, projectId)))
    .run();
}

async function allocateCopyName(
  database: D1Database,
  projectId: ProjectId,
  sourceName: string,
): Promise<string> {
  const taken = await listTakenSkillNames(database, projectId);
  return allocateCopyNameFromTaken(taken, sourceName);
}

async function listTakenSkillNames(
  database: D1Database,
  projectId: ProjectId,
): Promise<Set<string>> {
  const rows = await getAppDatabase(database)
    .select({
      name: skillsTable.name,
    })
    .from(skillsTable)
    .where(eq(skillsTable.projectId, projectId))
    .all();

  return new Set(rows.map((row) => row.name));
}

function allocateCopyNameFromTaken(taken: Set<string>, sourceName: string): string {
  const parsed = parseCopySuffix(sourceName);
  let counter = parsed.nextCounter;

  while (counter < 10_000) {
    const candidate =
      counter === 1 ? `${parsed.baseName} copy` : `${parsed.baseName} copy ${counter}`;

    if (!taken.has(candidate)) {
      return candidate;
    }

    counter += 1;
  }

  return `${parsed.baseName} copy ${Date.now()}`;
}

function parseCopySuffix(sourceName: string): { baseName: string; nextCounter: number } {
  const match = /^(.*) copy(?: (\d+))?$/.exec(sourceName);

  if (!match) {
    return {
      baseName: sourceName,
      nextCounter: 1,
    };
  }

  const baseName = match[1]!.trim();
  const currentCounter = isTruthy(match[2]) ? Number.parseInt(match[2], 10) : 1;

  return {
    baseName,
    nextCounter: currentCounter + 1,
  };
}
