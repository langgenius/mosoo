import type { SpaceView } from "@mosoo/contracts/space";
import { getSpaceNameValidationError } from "@mosoo/contracts/space";
import { useState } from "react";

import { createSpace, deleteSpace } from "../../domains/space/api/details";
import { isTruthy } from "../../shared/lib/truthiness";
import { toAppId, toSpaceId } from "../typed-id";
function getCreateSpaceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to create space.";
}

function getSpaceNameError(name: string): string | null {
  if (!name) {
    return null;
  }

  return getSpaceNameValidationError(name);
}

export function useSpaceSettings({
  refreshSpaces,
  selectSpace,
  appId,
}: {
  refreshSpaces: () => Promise<SpaceView[]>;
  selectSpace: (spaceId: string | null) => void;
  appId: string | null;
}) {
  const [showNewSpace, setShowNewSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [createSpaceError, setCreateSpaceError] = useState<string | null>(null);
  const [settingsSpaceId, setSettingsSpaceId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const newSpaceNameError = getSpaceNameError(newSpaceName);

  async function handleCreateSpace() {
    if (!isTruthy(appId) || !newSpaceName || Boolean(newSpaceNameError)) {
      return;
    }

    setCreatingSpace(true);
    setCreateSpaceError(null);

    try {
      const created = await createSpace(toAppId(appId), newSpaceName);
      await refreshSpaces();
      selectSpace(created.id);
      handleShowNewSpace(false);
    } catch (error: unknown) {
      setCreateSpaceError(getCreateSpaceErrorMessage(error));
    } finally {
      setCreatingSpace(false);
    }
  }

  function handleNewSpaceNameChange(value: string) {
    setNewSpaceName(value);
    setCreateSpaceError(null);
  }

  function handleShowNewSpace(open: boolean) {
    setShowNewSpace(open);

    if (!open) {
      setCreateSpaceError(null);
      setNewSpaceName("");
    }
  }

  function openSettings(spaceId: string) {
    setSettingsSpaceId(spaceId);
  }

  async function handleDeleteSpace() {
    if (!isTruthy(settingsSpaceId)) {
      return;
    }

    setDeletingSpace(true);

    try {
      if (!isTruthy(appId)) {
        return;
      }

      await deleteSpace(toAppId(appId), toSpaceId(settingsSpaceId));
      await refreshSpaces();
      selectSpace(null);
      setSettingsSpaceId(null);
      setShowDeleteConfirm(false);
      setDeleteConfirmationName("");
    } finally {
      setDeletingSpace(false);
    }
  }

  function handleShowDeleteConfirm(open: boolean) {
    setShowDeleteConfirm(open);

    if (!open) {
      setDeleteConfirmationName("");
    }
  }

  return {
    createSpaceError,
    creatingSpace,
    deleteConfirmationName,
    deletingSpace,
    handleCreateSpace,
    handleDeleteSpace,
    handleNewSpaceNameChange,
    handleShowDeleteConfirm,
    handleShowNewSpace,
    newSpaceName,
    newSpaceNameError,
    openSettings,
    setDeleteConfirmationName,
    setSettingsSpaceId,
    settingsSpaceId,
    showDeleteConfirm,
    showNewSpace,
  };
}
