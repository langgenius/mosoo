import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { FILE_UPLOAD_COMPLETED_EVENT } from "../../domains/file/api/file-upload-events";
import type { FileUploadCompletionEventDetail } from "../../domains/file/api/file-upload-events";
import { refreshSpaceFiles } from "../../domains/space/query/space-file-queries";
import { isTruthy } from "../../shared/lib/truthiness";
export function useSpaceUploadCompletionRefresh({
  activeSpace,
  currentPath,
  appId,
  queryClient,
}: {
  activeSpace: string | null;
  currentPath: string;
  appId: string | null;
  queryClient: QueryClient;
}) {
  useEffect(() => {
    function handleUploadCompleted(event: Event) {
      const { detail } = event as CustomEvent<FileUploadCompletionEventDetail>;

      if (
        !isTruthy(activeSpace) ||
        !isTruthy(appId) ||
        detail.scopeKind !== "space" ||
        detail.scopeId !== activeSpace
      ) {
        return;
      }

      void refreshSpaceFiles(queryClient, appId, activeSpace, currentPath);
    }

    globalThis.addEventListener(FILE_UPLOAD_COMPLETED_EVENT, handleUploadCompleted);
    return () => {
      globalThis.removeEventListener(FILE_UPLOAD_COMPLETED_EVENT, handleUploadCompleted);
    };
  }, [activeSpace, currentPath, appId, queryClient]);
}
