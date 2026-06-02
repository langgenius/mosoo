import { toFileId } from "@/routes/typed-id";

import { createFileDownload } from "./api/file-download-client";

export function isImageFile(mimeType: string | null): boolean {
  return mimeType?.toLowerCase().startsWith("image/") ?? false;
}

export async function openFileInline(fileId: string) {
  const { url } = createFileDownload(toFileId(fileId), "inline");
  const openedWindow = window.open(url, "_blank", "noopener");

  if (!openedWindow) {
    globalThis.location.assign(url);
  }
}

export async function downloadFile(fileId: string) {
  const { url } = createFileDownload(toFileId(fileId));
  globalThis.location.assign(url);
}
