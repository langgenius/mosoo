import type { ProjectId } from "@mosoo/id";

import { forbiddenError } from "../../../platform/errors";
import type { AuthenticatedViewer } from "./authenticated-viewer";

export function assertProjectKeyAccess(viewer: AuthenticatedViewer, projectId: ProjectId): void {
  if (viewer.projectId !== undefined && viewer.projectId !== projectId) {
    throw forbiddenError("This API key cannot access another Project.");
  }
}
