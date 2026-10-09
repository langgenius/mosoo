import type { SkillSummary } from "@mosoo/contracts/skill";
import { skillsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ProjectId, SkillId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { publishSkillSnapshot } from "./skill-package-snapshot.service";
import type { InspectSkillInput } from "./skill-package.shared";
import { getSkillSummary } from "./skill-query.service";

export async function createSkillFromUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  input: InspectSkillInput,
): Promise<SkillSummary> {
  const viewerId = viewer.id;
  await ensureProjectOwnership(bindings.DB, viewerId, projectId);
  const published = await publishSkillSnapshot(bindings, { projectId }, input);
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
      projectId,
      sourceKind: "user",
      updatedAt: timestampMs,
      version: published.snapshot.version,
    })
    .run();

  return getSkillSummary(bindings.DB, viewer, projectId, skillId);
}
