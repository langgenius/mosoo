import type { SkillSummary } from "@mosoo/contracts/skill";
import { skillsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AppId, SkillId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSkillEditor } from "./skill-access.service";
import { publishSkillSnapshot } from "./skill-package-snapshot.service";
import type { InspectSkillInput } from "./skill-package.shared";
import { getSkillSummary } from "./skill-query.service";

export async function createSkillFromUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  input: InspectSkillInput,
): Promise<SkillSummary> {
  const viewerId = viewer.id;
  await ensureAppOwnership(bindings.DB, viewerId, appId);
  const published = await publishSkillSnapshot(bindings, { appId }, input);
  const timestampMs = currentTimestampMs();
  const skillId = createPlatformId<SkillId>();

  await getAppDatabase(bindings.DB)
    .insert(skillsTable)
    .values({
      author: published.snapshot.author,
      createdAt: timestampMs,
      currentSnapshotId: published.snapshot.id,
      description: published.snapshot.description,
      id: skillId,
      name: published.snapshot.name,
      ownerAccountId: viewerId,
      appId,
      sourceKind: "user",
      updatedAt: timestampMs,
      version: published.snapshot.version,
    })
    .run();

  return getSkillSummary(bindings.DB, viewer, appId, skillId);
}

export async function updateOwnedSkillPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  skillId: SkillId,
  input: InspectSkillInput,
): Promise<SkillSummary> {
  const viewerId = viewer.id;
  await ensureSkillEditor(bindings.DB, viewerId, appId, skillId);
  const published = await publishSkillSnapshot(bindings, { appId }, input);
  const timestampMs = currentTimestampMs();

  await getAppDatabase(bindings.DB)
    .update(skillsTable)
    .set({
      author: published.snapshot.author,
      currentSnapshotId: published.snapshot.id,
      description: published.snapshot.description,
      name: published.snapshot.name,
      updatedAt: timestampMs,
      version: published.snapshot.version,
    })
    .where(eq(skillsTable.id, skillId))
    .run();

  return getSkillSummary(bindings.DB, viewer, appId, skillId);
}
