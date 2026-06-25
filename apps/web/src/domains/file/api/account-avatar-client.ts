import type { AccountId } from "@mosoo/contracts/id";

import { apiPath } from "@/platform/http/public-api";

import { createAndRunFileUpload } from "./file-upload-client";

/**
 * Uploads an image for the current account's avatar and returns the internal
 * file URL that can be stored as the account image. The returned path matches
 * the internal-file pattern accepted by the profile update mutation.
 */
export async function uploadAccountAvatar(accountId: AccountId, file: File): Promise<string> {
  const { fileId } = await createAndRunFileUpload(
    {
      file: {
        contentType: file.type,
        name: file.name,
        size: file.size,
      },
      overwrite: true,
      purpose: "account_avatar",
      target: {
        id: accountId,
        kind: "account",
        name: file.name,
      },
    },
    file,
  );

  return apiPath(`/files/${fileId}/content?disposition=inline`);
}
