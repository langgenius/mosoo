import { parsePlatformId } from "@mosoo/id";
import type { SkillId } from "@mosoo/id";

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
  skillId: string,
): Promise<string> {
  const parsedSkillId = parsePlatformId<SkillId>(skillId, "skill ID");
  const skill = await ensureSkillAccess(bindings.DB, viewer.id, parsedSkillId);
  return readSkillMarkdownFromSnapshot(bindings, skill.currentSnapshotId);
}

export async function downloadSkillPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  skillId: string,
): Promise<{
  bytes: Uint8Array;
  fileName: string;
}> {
  const parsedSkillId = parsePlatformId<SkillId>(skillId, "skill ID");
  const skill = await ensureSkillAccess(bindings.DB, viewer.id, parsedSkillId);

  return {
    bytes: await readSkillPackageBytesFromSnapshot(bindings, skill.currentSnapshotId),
    fileName: `${sanitizeFileStem(skill.name)}.skill`,
  };
}

function sanitizeFileStem(value: string): string {
  return value.replaceAll(/[^\w.-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "skill";
}
