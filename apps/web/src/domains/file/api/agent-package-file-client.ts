import type { FileId, OrganizationId } from "@mosoo/contracts/id";

import { createAndRunFileUpload } from "./file-upload-client";

export async function uploadAgentPackageFile(
  organizationId: OrganizationId,
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
        id: organizationId,
        kind: "agent_package",
        name: file.name,
      },
    },
    file,
  );
}
