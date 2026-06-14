import { useAuth } from "../../domains/auth/use-auth";
import { SpaceSidebar } from "./sidebar";
import {
  canManageSpaceSettings,
  canWriteToSpace,
  getSpaceManagementDisabledReason,
} from "./space-access";
import { SpaceFilesView } from "./space-files-view";
import { SpacePageDialogs } from "./space-page-dialogs";
import { SpacesHub } from "./spaces-hub";
import { useSpaceBrowser } from "./use-space-browser";
import { useSpaceList } from "./use-space-list";
import { useSpaceSettings } from "./use-space-settings";

export function SpacePage() {
  const { user } = useAuth();
  const {
    activeSpace,
    currentPath,
    hoveredSpace,
    loading: spacesLoading,
    appId,
    refreshSpaces,
    selectSpace,
    setCurrentPath,
    setHoveredSpace,
    spaces,
  } = useSpaceList();
  const browser = useSpaceBrowser({
    activeSpace,
    currentPath,
    appId,
    spaces,
  });
  const settings = useSpaceSettings({
    appId,
    refreshSpaces,
    selectSpace,
  });

  const activeSpaceData = spaces.find((space) => space.id === activeSpace);
  const settingsSpace = spaces.find((space) => space.id === settings.settingsSpaceId);
  const canWrite = canWriteToSpace(activeSpaceData?.role);
  const canManageSpace = (space: (typeof spaces)[number]) =>
    canManageSpaceSettings({
      space,
      viewerId: user?.id,
    });
  const getManageDisabledReason = (space: (typeof spaces)[number]) =>
    getSpaceManagementDisabledReason({
      space,
      viewerId: user?.id,
    });
  function handleOpenSettings(spaceId: string) {
    const space = spaces.find((entry) => entry.id === spaceId);

    if (!space || !canManageSpace(space)) {
      return;
    }

    settings.openSettings(spaceId);
    settings.handleShowDeleteConfirm(true);
  }

  const showHub = !activeSpace;

  return (
    <div className="flex h-full">
      {showHub ? (
        <SpacesHub
          spaces={spaces}
          loading={spacesLoading}
          canManageSpace={canManageSpace}
          getManageDisabledReason={getManageDisabledReason}
          onSelectSpace={selectSpace}
          onOpenSettings={handleOpenSettings}
          onCreateSpace={() => {
            settings.handleShowNewSpace(true);
          }}
        />
      ) : (
        <>
          <SpaceSidebar
            activeSpaceId={activeSpace}
            hoveredSpaceId={hoveredSpace}
            onCreateSpace={() => {
              settings.handleShowNewSpace(true);
            }}
            canManageSpace={canManageSpace}
            getManageDisabledReason={getManageDisabledReason}
            onHoverSpace={setHoveredSpace}
            onOpenSettings={handleOpenSettings}
            onSelectSpace={selectSpace}
            spaces={spaces}
            onBackToHub={() => {
              selectSpace(null);
            }}
          />

          <main className="flex min-w-0 flex-1 flex-col">
            <SpaceFilesView
              activeSpace={activeSpaceData}
              browser={browser}
              canWrite={canWrite}
              currentPath={currentPath}
              onCreateSpace={() => {
                settings.handleShowNewSpace(true);
              }}
              onCurrentPathChange={setCurrentPath}
            />
          </main>
        </>
      )}

      <SpacePageDialogs browser={browser} settings={settings} settingsSpace={settingsSpace} />
    </div>
  );
}
