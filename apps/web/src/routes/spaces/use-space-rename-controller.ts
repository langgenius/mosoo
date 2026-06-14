import type { FileEntry } from "@mosoo/contracts/space";
import { useRef, useState } from "react";

import { renameSpaceFile } from "../../domains/file/api/space-file-client";
import { acquireSpaceFileLock, releaseSpaceFileLock } from "../../domains/space/api/file-locks";
import { isTruthy } from "../../shared/lib/truthiness";
import { toAppId, toSpaceId } from "../typed-id";
import { getErrorMessage, getFileNameValidationError } from "./use-space-browser-upload";
interface RenameLockState {
  blockedBy?: string | undefined;
  lockId?: string | undefined;
  path: string;
  spaceId: string;
}

interface UseSpaceRenameControllerInput {
  activeSpace: string | null;
  currentPath: string;
  appId: string | null;
  refreshFiles: () => Promise<void>;
  setFileActionError: (message: string | null) => void;
}

export function useSpaceRenameController({
  activeSpace,
  currentPath,
  appId,
  refreshFiles,
  setFileActionError,
}: UseSpaceRenameControllerInput) {
  const renameLockRequestRef = useRef(0);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameLock, setRenameLock] = useState<RenameLockState | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameTargetSpaceId, setRenameTargetSpaceId] = useState<string | null>(null);

  function closeRenameFile() {
    renameLockRequestRef.current += 1;
    const lock = renameLock;

    if (isTruthy(lock?.lockId) && isTruthy(appId)) {
      void releaseSpaceFileLock(toAppId(appId), toSpaceId(lock.spaceId), {
        lockId: lock.lockId,
        path: lock.path,
      });
    }

    setRenameTarget(null);
    setRenameTargetSpaceId(null);
    setRenameError(null);
    setRenameLock(null);
  }

  function openRenameFile(file: FileEntry) {
    const requestId = renameLockRequestRef.current + 1;
    renameLockRequestRef.current = requestId;
    setRenameTarget(file);
    setRenameValue(file.key.replace(currentPath, ""));
    setRenameTargetSpaceId(activeSpace);
    setRenameError(null);
    setRenameLock(null);

    if (!isTruthy(appId) || !isTruthy(activeSpace)) {
      return;
    }

    void acquireSpaceFileLock(toAppId(appId), toSpaceId(activeSpace), {
      path: file.key,
    })
      .then((result) => {
        if (renameLockRequestRef.current !== requestId) {
          return;
        }

        if (result.ok) {
          setRenameLock({
            lockId: result.lockId,
            path: file.key,
            spaceId: activeSpace,
          });
          return;
        }

        const holder = result.holder?.displayName ?? result.holder?.id ?? "Someone";
        setRenameLock({
          blockedBy: holder,
          path: file.key,
          spaceId: activeSpace,
        });
        setRenameError(`${holder} is editing this file.`);
      })
      .catch((error: unknown) => {
        if (renameLockRequestRef.current !== requestId) {
          return;
        }

        setRenameError(getErrorMessage(error, "Could not acquire file lock."));
      });
  }

  function handleSetRenameValue(value: string) {
    setRenameValue(value);
    setRenameError(getFileNameValidationError(value));
  }

  async function handleRenameFile() {
    if (!renameTarget || !isTruthy(appId)) {
      return;
    }

    if (isTruthy(renameLock?.blockedBy)) {
      setRenameError(`${renameLock.blockedBy} is editing this file.`);
      return;
    }

    const trimmed = renameValue.trim();

    if (!trimmed) {
      setRenameError("File name is required.");
      return;
    }

    const validationError = getFileNameValidationError(trimmed);

    if (isTruthy(validationError)) {
      setRenameError(validationError);
      return;
    }

    setRenaming(true);
    setRenameError(null);
    setFileActionError(null);

    try {
      const targetSpaceId = renameTargetSpaceId ?? activeSpace ?? undefined;
      const nextPath =
        Boolean(targetSpaceId) && targetSpaceId !== activeSpace
          ? trimmed.replace(/^\/+/, "")
          : currentPath
            ? `${currentPath}${trimmed}`
            : trimmed;

      await renameSpaceFile(
        renameTarget.id,
        nextPath,
        renameTarget.version,
        renameTarget.etag,
        targetSpaceId !== activeSpace && targetSpaceId !== undefined
          ? toSpaceId(targetSpaceId)
          : undefined,
      );
      if (isTruthy(renameLock?.lockId) && isTruthy(appId)) {
        void releaseSpaceFileLock(toAppId(appId), toSpaceId(renameLock.spaceId), {
          lockId: renameLock.lockId,
          path: renameLock.path,
        });
      }
      setRenameTarget(null);
      setRenameValue("");
      setRenameTargetSpaceId(null);
      setRenameLock(null);
      await refreshFiles();
    } catch (error) {
      setRenameError(getErrorMessage(error, "Rename failed."));
    } finally {
      setRenaming(false);
    }
  }

  return {
    closeRenameFile,
    handleRenameFile,
    openRenameFile,
    renameError,
    renameLock,
    renameTarget,
    renameTargetSpaceId,
    renameValue,
    renaming,
    setRenameError,
    setRenameTarget,
    setRenameTargetSpaceId,
    setRenameValue: handleSetRenameValue,
  };
}
