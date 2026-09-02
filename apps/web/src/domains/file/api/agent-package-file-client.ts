import type { FileId, ProjectId } from "@mosoo/contracts/id";

import { createAndRunFileUpload } from "./file-upload-client";

export async function uploadAgentPackageFile(
  projectId: ProjectId,
  file: File,
): Promise<{ fileId: FileId }> {
  return createAndRunFileUpload(
    {
      file: {
        contentType: file.type || "application/zip",
        name: file.name,
        size: file.size,
      },
      overwrite: true,
      purpose: "agent_package",
      target: {
        id: projectId,
        kind: "agent_package",
        name: file.name,
      },
    },
    file,
  );
}
