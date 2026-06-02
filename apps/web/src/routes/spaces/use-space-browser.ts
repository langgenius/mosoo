import type { SpaceView } from "@mosoo/contracts/space";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DragEvent } from "react";

import {
  refreshSpaceFiles,
  useSpaceFilesQuery,
} from "../../domains/space/query/space-file-queries";
import { isTruthy } from "../../shared/lib/truthiness";
import { getErrorMessage } from "./use-space-browser-upload";
import { useSpaceEntryActions } from "./use-space-entry-actions";
import { useSpaceRenameController } from "./use-space-rename-controller";
import { useSpaceUploadCompletionRefresh } from "./use-space-upload-completion-refresh";
import { useSpaceUploadController } from "./use-space-upload-controller";
export function useSpaceBrowser({
  activeSpace,
  currentPath,
  spaces,
}: {
  activeSpace: string | null;
  currentPath: string;
  spaces: SpaceView[];
}) {
  const queryClient = useQueryClient();
  const fileListingQuery = useSpaceFilesQuery(activeSpace, currentPath);
  const files = fileListingQuery.data?.files ?? [];
  const dirs = fileListingQuery.data?.directories ?? [];
  const listingError = fileListingQuery.error
    ? getErrorMessage(fileListingQuery.error, "Could not load files.")
    : null;
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [dragOver, setDragOver] = useState(false);
  const writableSpaces = spaces.filter((space) => space.role === "edit" || space.role === "admin");

  useSpaceUploadCompletionRefresh({
    activeSpace,
    currentPath,
    queryClient,
  });

  async function refreshFiles(): Promise<void> {
    if (!isTruthy(activeSpace)) {
      return;
    }

    await refreshSpaceFiles(queryClient, activeSpace, currentPath);
  }

  const entryActions = useSpaceEntryActions({
    activeSpace,
    currentPath,
    files,
    refreshFiles,
  });
  const uploads = useSpaceUploadController({
    activeSpace,
    currentPath,
    refreshFiles,
    setFileActionError: entryActions.setFileActionError,
  });
  const renames = useSpaceRenameController({
    activeSpace,
    currentPath,
    refreshFiles,
    setFileActionError: entryActions.setFileActionError,
  });

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    void uploads.handleUpload(event.dataTransfer.files);
  }

  function goUp() {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    return parts.length > 0 ? `${parts.join("/")}/` : "";
  }

  return {
    activeSpaceId: activeSpace,
    closeRenameFile: renames.closeRenameFile,
    dirs,
    dragOver,
    fileActionError: entryActions.fileActionError,
    fileInputRef: uploads.fileInputRef,
    files,
    folderInputRef: uploads.folderInputRef,
    goUp,
    handleCancelUploadConflict: uploads.handleCancelUploadConflict,
    handleCreateFolder: entryActions.handleCreateFolder,
    handleDeleteDirectory: entryActions.handleDeleteDirectory,
    handleDeleteFile: entryActions.handleDeleteFile,
    handleDownloadFile: entryActions.handleDownloadFile,
    handleDrop,
    handleOpenFile: entryActions.handleOpenFile,
    handleRenameFile: renames.handleRenameFile,
    handleResolveUploadConflict: uploads.handleResolveUploadConflict,
    handleRetryUpload: uploads.handleRetryUpload,
    handleUpload: uploads.handleUpload,
    listingError,
    loading: activeSpace !== null && fileListingQuery.isFetching,
    newFolderError: entryActions.newFolderError,
    newFolderName: entryActions.newFolderName,
    openRenameFile: renames.openRenameFile,
    pendingUploadConflict: uploads.pendingUploadConflict,
    renameError: renames.renameError,
    renameLock: renames.renameLock,
    renameTarget: renames.renameTarget,
    renameTargetSpaceId: renames.renameTargetSpaceId,
    renameValue: renames.renameValue,
    renaming: renames.renaming,
    setDragOver,
    setNewFolderName: entryActions.setNewFolderName,
    setRenameError: renames.setRenameError,
    setRenameTarget: renames.setRenameTarget,
    setRenameTargetSpaceId: renames.setRenameTargetSpaceId,
    setRenameValue: renames.setRenameValue,
    setShowNewFolder: entryActions.setShowNewFolder,
    setViewMode,
    showNewFolder: entryActions.showNewFolder,
    uploadRows: uploads.uploadRows,
    uploadSummary: uploads.uploadSummary,
    uploading: uploads.uploading,
    viewMode,
    writableSpaces,
  };
}
