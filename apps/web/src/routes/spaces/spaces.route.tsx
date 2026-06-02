import { useAppSession } from "../../app/session-provider";
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
  const { activeOrganization } = useAppSession();
  const {
    activeSpace,
    currentPath,
    hoveredSpace,
    loading: spacesLoading,
    organizationId,
    refreshSpaces,
    selectSpace,
    setCurrentPath,
    setHoveredSpace,
    spaces,
  } = useSpaceList();
  const browser = useSpaceBrowser({
    activeSpace,
    currentPath,
    spaces,
  });
  const settings = useSpaceSettings({
    organizationId,
    refreshSpaces,
    selectSpace,
  });

  const activeSpaceData = spaces.find((space) => space.id === activeSpace);
  const settingsSpace = spaces.find((space) => space.id === settings.settingsSpaceId);
  const viewerOrganizationRole =
    activeOrganization?.id === organizationId ? activeOrganization.viewerRole : null;
  const canWrite = canWriteToSpace(activeSpaceData?.role);
  const canManageSpace = (space: (typeof spaces)[number]) =>
    canManageSpaceSettings({
      space,
      viewerId: user?.id,
      viewerOrganizationRole,
    });
  const getManageDisabledReason = (space: (typeof spaces)[number]) =>
    getSpaceManagementDisabledReason({
      space,
      viewerId: user?.id,
      viewerOrganizationRole,
    });
  const canManageSettingsSpace = settingsSpace ? canManageSpace(settingsSpace) : false;

  function handleOpenSettings(spaceId: string) {
    const space = spaces.find((entry) => entry.id === spaceId);

    if (!space || !canManageSpace(space)) {
      return;
    }

    settings.openSettings(spaceId);
  }

  const showHub = !activeSpace;

  return (
    <div className="flex h-full">
      {showHub ? (
        <SpacesHub
          spaces={spaces}
          userId={user?.id}
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
            userId={user?.id}
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

      <SpacePageDialogs
        browser={browser}
        canManageSettingsSpace={canManageSettingsSpace}
        organizationId={organizationId}
        settings={settings}
        settingsSpace={settingsSpace}
        userId={user?.id}
      />
    </div>
  );
}
