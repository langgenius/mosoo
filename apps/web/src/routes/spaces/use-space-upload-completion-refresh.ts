import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { FILE_UPLOAD_COMPLETED_EVENT } from "../../domains/file/api/file-upload-events";
import type { FileUploadCompletionEventDetail } from "../../domains/file/api/file-upload-events";
import { refreshSpaceFiles } from "../../domains/space/query/space-file-queries";
import { isTruthy } from "../../shared/lib/truthiness";
export function useSpaceUploadCompletionRefresh({
  activeSpace,
  currentPath,
  queryClient,
}: {
  activeSpace: string | null;
  currentPath: string;
  queryClient: QueryClient;
}) {
  useEffect(() => {
    function handleUploadCompleted(event: Event) {
      const { detail } = event as CustomEvent<FileUploadCompletionEventDetail>;

      if (
        !isTruthy(activeSpace) ||
        detail.scopeKind !== "space" ||
        detail.scopeId !== activeSpace
      ) {
        return;
      }

      void refreshSpaceFiles(queryClient, activeSpace, currentPath);
    }

    globalThis.addEventListener(FILE_UPLOAD_COMPLETED_EVENT, handleUploadCompleted);
    return () => {
      globalThis.removeEventListener(FILE_UPLOAD_COMPLETED_EVENT, handleUploadCompleted);
    };
  }, [activeSpace, currentPath, queryClient]);
}
