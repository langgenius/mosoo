import type { ProjectId, SkillId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSkillAccess } from "./skill-access.service";
import {
  readSkillMarkdownFromSnapshot,
  readSkillPackageBytesFromSnapshot,
} from "./skill-package-snapshot.service";

export async function readSkillSource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<string> {
  const skill = await ensureSkillAccess(bindings.DB, viewer.id, projectId, skillId);
  return readSkillMarkdownFromSnapshot(bindings, skill.currentSnapshotId);
}

export async function downloadSkillPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<{
  bytes: Uint8Array;
  fileName: string;
}> {
  const skill = await ensureSkillAccess(bindings.DB, viewer.id, projectId, skillId);

  return {
    bytes: await readSkillPackageBytesFromSnapshot(bindings, skill.currentSnapshotId),
    fileName: `${sanitizeFileStem(skill.name)}.skill`,
  };
}

function sanitizeFileStem(value: string): string {
  return value.replaceAll(/[^\w.-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "skill";
}
