import type { FileId, ProjectId } from "@mosoo/contracts/id";

import { createAndRunFileUpload } from "./file-upload-client";

export async function uploadProjectDraftFiles(
  projectId: ProjectId,
  files: File[],
): Promise<{ uploaded: FileId[] }> {
  const results = await Promise.all(
    files.map((file) =>
      createAndRunFileUpload(
        {
          file: {
            contentType: file.type,
            name: file.name,
            size: file.size,
          },
          overwrite: true,
          purpose: "app_draft",
          target: {
            id: projectId,
            kind: "app_draft",
            name: file.name,
          },
        },
        file,
      ),
    ),
  );

  return {
    uploaded: results.map((result) => result.fileId),
  };
}
