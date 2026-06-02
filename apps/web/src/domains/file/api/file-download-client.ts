import type { CreateFileDownloadResponse } from "@mosoo/contracts/file";
import type { FileId } from "@mosoo/contracts/id";

import { apiPath } from "@/platform/http/public-api";

export function createFileDownload(
  fileId: FileId,
  disposition: "attachment" | "inline" = "attachment",
): CreateFileDownloadResponse {
  return {
    method: "GET" as const,
    url: apiPath(`/files/${fileId}/content?disposition=${encodeURIComponent(disposition)}`),
  };
}
