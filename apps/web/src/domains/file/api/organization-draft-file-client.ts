import type { FileId, OrganizationId } from "@mosoo/contracts/id";

import { createAndRunFileUpload } from "./file-upload-client";

export async function uploadOrganizationDraftFiles(
  organizationId: OrganizationId,
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
          purpose: "organization_draft",
          target: {
            id: organizationId,
            kind: "organization_draft",
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
