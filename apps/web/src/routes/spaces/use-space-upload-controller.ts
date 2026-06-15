import { useRef, useState } from "react";

import { uploadSpaceFiles } from "../../domains/file/api/space-file-client";
import { isTruthy } from "../../shared/lib/truthiness";
import { toAppId, toSpaceId } from "../typed-id";
import { createUploadRow, getErrorMessage, readCurrentEtag } from "./use-space-browser-upload";
import type { PendingUploadConflict, UploadRow } from "./use-space-browser-upload";
interface UseSpaceUploadControllerInput {
  activeSpace: string | null;
  currentPath: string;
  appId: string | null;
  refreshFiles: () => Promise<void>;
  setFileActionError: (message: string | null) => void;
}

export function useSpaceUploadController({
  activeSpace,
  currentPath,
  appId,
  refreshFiles,
  setFileActionError,
}: UseSpaceUploadControllerInput) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{
    failedFileName: string | null;
    message: string;
  } | null>(null);
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [pendingUploadConflict, setPendingUploadConflict] = useState<PendingUploadConflict | null>(
    null,
  );

  async function runUploadBatch(
    inputFiles: File[],
    parentPath: string | undefined,
    options: {
      conflictMode?: "fail" | "keep_both" | "replace";
      replaceIfMatchEtag?: string | undefined;
      rows?: UploadRow[];
    } = {},
  ) {
    if (!isTruthy(appId) || !isTruthy(activeSpace) || inputFiles.length === 0) {
      return;
    }

    const rows =
      options.rows ?? inputFiles.map((file, index) => createUploadRow(file, index, parentPath));
    setUploadRows(rows);
    setUploading(true);
    setUploadSummary(null);
    setFileActionError(null);

    try {
      const result = await uploadSpaceFiles(
        toAppId(appId),
        toSpaceId(activeSpace),
        inputFiles,
        parentPath,
        {
          conflictMode: options.conflictMode,
          replaceIfMatchEtag: options.replaceIfMatchEtag,
          onFileProgress(progress) {
            const rowId = rows[progress.index]?.id;

            if (!isTruthy(rowId)) {
              return;
            }

            setUploadRows((current) =>
              current.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      error: progress.error,
                      path: progress.path,
                      status: progress.status,
                    }
                  : row,
              ),
            );
          },
        },
      );

      if (result.successCount > 0) {
        await refreshFiles();
      }

      if (result.error) {
        recordUploadFailure(result, rows, parentPath);
      } else {
        setUploadRows([]);
      }
    } catch (error) {
      setUploadSummary({
        failedFileName: null,
        message: getErrorMessage(error, "Upload failed."),
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    setPendingUploadConflict(null);
    await runUploadBatch([...fileList], currentPath || undefined);
  }

  async function handleResolveUploadConflict(conflictMode: "keep_both" | "replace") {
    if (!pendingUploadConflict) {
      return;
    }

    const files = [pendingUploadConflict.failedFile, ...pendingUploadConflict.remainingFiles];
    const replaceIfMatchEtag =
      conflictMode === "replace" ? pendingUploadConflict.currentEtag : undefined;
    setPendingUploadConflict(null);
    await runUploadBatch(files, pendingUploadConflict.parentPath, {
      conflictMode,
      replaceIfMatchEtag,
    });
  }

  function handleCancelUploadConflict() {
    setPendingUploadConflict(null);
  }

  async function handleRetryUpload(rowId: string) {
    const row = uploadRows.find((entry) => entry.id === rowId);

    if (!row) {
      return;
    }

    await runUploadBatch([row.file], row.parentPath, {
      rows: [
        {
          ...row,
          error: undefined,
          status: "waiting",
        },
      ],
    });
  }

  function recordUploadFailure(
    result: Awaited<ReturnType<typeof uploadSpaceFiles>>,
    rows: UploadRow[],
    parentPath: string | undefined,
  ) {
    const failedRowId =
      typeof result.failedFileIndex === "number" ? rows[result.failedFileIndex]?.id : undefined;
    const skippedRowIds = new Set(
      rows.slice((result.failedFileIndex ?? rows.length - 1) + 1).map((row) => row.id),
    );

    setUploadRows((current) =>
      current.map((row) => {
        if (Boolean(failedRowId) && row.id === failedRowId) {
          return {
            ...row,
            error: result.error?.message,
            status: "failed",
          };
        }

        if (skippedRowIds.has(row.id)) {
          return {
            ...row,
            status: "skipped",
          };
        }

        return row;
      }),
    );

    setUploadSummary({
      failedFileName: result.failedFileName,
      message: `Uploaded ${result.successCount} file${result.successCount === 1 ? "" : "s"}. Failed file: ${result.failedFileName ?? "Unknown file"}. Skipped ${result.skippedCount}.`,
    });

    if (result.error?.code === "file_conflict" && result.failedFile) {
      setPendingUploadConflict({
        currentEtag: readCurrentEtag(result.error),
        failedFile: result.failedFile,
        failedFileName: result.failedFileName ?? result.failedFile.name,
        message: result.error.message,
        parentPath,
        remainingFiles: result.remainingFiles ?? [],
      });
    }
  }

  return {
    fileInputRef,
    folderInputRef,
    handleCancelUploadConflict,
    handleResolveUploadConflict,
    handleRetryUpload,
    handleUpload,
    pendingUploadConflict,
    uploadRows,
    uploadSummary,
    uploading,
  };
}
