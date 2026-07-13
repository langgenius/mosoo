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

export async function readFileText(fileId: FileId, signal?: AbortSignal): Promise<string> {
  const download = createFileDownload(fileId, "inline");
  const response = await fetch(download.url, {
    method: download.method,
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    throw new Error(`Failed to load file preview (${response.status}).`);
  }

  return response.text();
}
