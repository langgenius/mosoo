import type { ProjectId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../projects/application/project.service";
import { publicNotFound } from "./public-api-errors";

export async function admitPublicProjectCaller(
  database: D1Database,
  caller: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<void> {
  if (caller.projectId !== undefined && caller.projectId !== projectId) {
    throw publicNotFound("Project not found.");
  }
  await ensureProjectOwnership(database, caller.id, projectId);
}
