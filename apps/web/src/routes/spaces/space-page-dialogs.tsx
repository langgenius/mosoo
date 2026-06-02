import type { SpaceView } from "@mosoo/contracts/space";
import type { ReactElement } from "react";

import { SpaceSettingsDialog } from "../../features/spaces/share-space/dialog";
import { DeleteSpaceDialog, NewSpaceDialog, RenameFileDialog } from "./dialogs";
import type { useSpaceBrowser } from "./use-space-browser";
import type { useSpaceSettings } from "./use-space-settings";

type SpaceBrowserModel = ReturnType<typeof useSpaceBrowser>;
type SpaceSettingsModel = ReturnType<typeof useSpaceSettings>;

export function SpacePageDialogs({
  browser,
  canManageSettingsSpace,
  organizationId,
  settings,
  settingsSpace,
  userId,
}: {
  browser: SpaceBrowserModel;
  canManageSettingsSpace: boolean;
  organizationId: string | null;
  settings: SpaceSettingsModel;
  settingsSpace: SpaceView | undefined;
  userId: string | undefined;
}): ReactElement {
  const showSettingsDialog =
    settings.settingsSpaceId !== null &&
    settingsSpace !== undefined &&
    organizationId !== null &&
    userId !== undefined;
  const renameBlockedBy = browser.renameLock?.blockedBy ?? null;
  const renameReadOnlyReason =
    renameBlockedBy !== null && renameBlockedBy.length > 0
      ? `${renameBlockedBy} is editing this file.`
      : null;
  const handleSelectNewSpaceVisibility = (visibility: "shared" | "private"): void => {
    settings.setNewSpaceVisibility(visibility);
  };
  const handleRenameValueChange = (value: string): void => {
    browser.setRenameValue(value);
  };
  const handleRenameTargetSpaceChange = (spaceId: string): void => {
    browser.setRenameTargetSpaceId(spaceId);
  };
  const handleCloseRenameFile = (): void => {
    browser.closeRenameFile();
  };
  const handleDeleteConfirmationNameChange = (name: string): void => {
    settings.setDeleteConfirmationName(name);
  };
  const deleteSpaceName = settingsSpace?.name;

  const settingsDialog = showSettingsDialog ? (
    <SpaceSettingsDialog
      key={settingsSpace.id}
      open={showSettingsDialog}
      onOpenChange={(open) => {
        if (!open) {
          settings.setSettingsSpaceId(null);
        }
      }}
      spaceId={settingsSpace.id}
      spaceName={settingsSpace.name}
      spaceOwnerId={settingsSpace.ownerId}
      organizationId={organizationId}
      currentUserId={userId}
      isAdmin={canManageSettingsSpace}
      {...(canManageSettingsSpace
        ? {
            onDeleteSpace: () => {
              settings.handleShowDeleteConfirm(true);
            },
          }
        : {})}
    />
  ) : null;

  return (
    <>
      {settingsDialog}

      <NewSpaceDialog
        creating={settings.creatingSpace}
        error={settings.createSpaceError ?? settings.newSpaceNameError}
        name={settings.newSpaceName}
        onChangeName={settings.handleNewSpaceNameChange}
        onClose={() => {
          settings.handleShowNewSpace(false);
        }}
        onCreate={() => void settings.handleCreateSpace()}
        onOpenChange={settings.handleShowNewSpace}
        onSelectVisibility={handleSelectNewSpaceVisibility}
        open={settings.showNewSpace}
        visibility={settings.newSpaceVisibility}
      />

      <RenameFileDialog
        currentSpaceId={browser.activeSpaceId}
        error={browser.renameError}
        onChangeValue={handleRenameValueChange}
        onChangeTargetSpaceId={handleRenameTargetSpaceChange}
        onClose={handleCloseRenameFile}
        onOpenChange={(open) => {
          if (!open) {
            browser.closeRenameFile();
          }
        }}
        onRename={() => void browser.handleRenameFile()}
        open={browser.renameTarget !== null}
        readOnlyReason={renameReadOnlyReason}
        renaming={browser.renaming}
        targetSpaceId={browser.renameTargetSpaceId}
        targetSpaces={browser.writableSpaces}
        value={browser.renameValue}
      />

      <DeleteSpaceDialog
        confirmationName={settings.deleteConfirmationName}
        deleting={settings.deletingSpace}
        name={deleteSpaceName}
        onChangeConfirmationName={handleDeleteConfirmationNameChange}
        onDelete={() => void settings.handleDeleteSpace()}
        onOpenChange={settings.handleShowDeleteConfirm}
        open={settings.showDeleteConfirm}
      />
    </>
  );
}
