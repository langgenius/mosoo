import type { FileEntry } from "@mosoo/contracts/space";
import { useState } from "react";

import { deleteFileRecordWithPrecondition } from "../../domains/file/api/space-file-client";
import { downloadFile, openFileInline } from "../../domains/file/file-open";
import { createFolder, deleteSpaceEntry } from "../../domains/space/api/files";
import { isTruthy } from "../../shared/lib/truthiness";
import { toFileId, toSpaceId } from "../typed-id";
import { getErrorMessage } from "./use-space-browser-upload";
interface UseSpaceEntryActionsInput {
  activeSpace: string | null;
  currentPath: string;
  files: FileEntry[];
  refreshFiles: () => Promise<void>;
}

export function useSpaceEntryActions({
  activeSpace,
  currentPath,
  files,
  refreshFiles,
}: UseSpaceEntryActionsInput) {
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);

  async function handleCreateFolder() {
    if (!isTruthy(activeSpace) || !newFolderName.trim()) {
      return;
    }

    setFileActionError(null);

    try {
      await createFolder(toSpaceId(activeSpace), newFolderName.trim(), currentPath || undefined);
      await refreshFiles();
      setShowNewFolder(false);
      setNewFolderName("");
      setNewFolderError(null);
    } catch (error) {
      setNewFolderError(getErrorMessage(error, "Create folder failed."));
    }
  }

  async function handleDeleteDirectory(key: string) {
    if (!isTruthy(activeSpace)) {
      return;
    }

    try {
      await deleteSpaceEntry(toSpaceId(activeSpace), key);
      await refreshFiles();
      setFileActionError(null);
    } catch (error) {
      setFileActionError(getErrorMessage(error, "Delete folder failed."));
    }
  }

  async function handleDeleteFile(fileId: string) {
    try {
      const file = files.find((entry) => entry.id === fileId);
      await deleteFileRecordWithPrecondition(toFileId(fileId), file?.etag);
      await refreshFiles();
      setFileActionError(null);
    } catch (error) {
      setFileActionError(getErrorMessage(error, "Delete file failed."));
    }
  }

  async function handleDownloadFile(fileId: string) {
    try {
      await downloadFile(toFileId(fileId));
      setFileActionError(null);
    } catch (error) {
      setFileActionError(getErrorMessage(error, "Download failed."));
    }
  }

  async function handleOpenFile(fileId: string) {
    try {
      await openFileInline(toFileId(fileId));
      setFileActionError(null);
    } catch (error) {
      setFileActionError(getErrorMessage(error, "Open file failed."));
    }
  }

  function handleSetShowNewFolder(open: boolean) {
    setShowNewFolder(open);

    if (!open) {
      setNewFolderName("");
      setNewFolderError(null);
    }
  }

  function handleSetNewFolderName(value: string) {
    setNewFolderName(value);
    setNewFolderError(null);
  }

  return {
    fileActionError,
    handleCreateFolder,
    handleDeleteDirectory,
    handleDeleteFile,
    handleDownloadFile,
    handleOpenFile,
    newFolderError,
    newFolderName,
    setFileActionError,
    setNewFolderName: handleSetNewFolderName,
    setShowNewFolder: handleSetShowNewFolder,
    showNewFolder,
  };
}
