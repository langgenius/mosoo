import type { FileUploadCompletionEventDetail } from "@/shared/lib/file-api-error";

export const FILE_UPLOAD_COMPLETED_EVENT = "file-upload-completed";
export type { FileUploadCompletionEventDetail } from "@/shared/lib/file-api-error";

export function dispatchUploadCompleted(detail: FileUploadCompletionEventDetail): void {
  globalThis.dispatchEvent(
    new CustomEvent<FileUploadCompletionEventDetail>(FILE_UPLOAD_COMPLETED_EVENT, {
      detail,
    }),
  );
}
