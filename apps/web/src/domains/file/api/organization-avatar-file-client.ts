import type { FileId, OrganizationId } from "@mosoo/contracts/id";
import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { createAndRunFileUpload } from "./file-upload-client";

export interface OrganizationAvatarUploadResult {
  fileId: FileId;
  url: string;
}

function organizationAvatarFileUrl(fileId: FileId): string {
  return `${PUBLIC_API_PREFIX}/files/${fileId}/content?disposition=inline`;
}

export async function uploadOrganizationAvatar(
  organizationId: OrganizationId,
  file: File,
): Promise<OrganizationAvatarUploadResult> {
  const result = await createAndRunFileUpload(
    {
      file: {
        contentType: file.type,
        name: file.name,
        size: file.size,
      },
      overwrite: true,
      purpose: "organization_avatar",
      target: {
        id: organizationId,
        kind: "organization_avatar",
        name: file.name,
      },
    },
    file,
  );

  return {
    fileId: result.fileId,
    url: organizationAvatarFileUrl(result.fileId),
  };
}
