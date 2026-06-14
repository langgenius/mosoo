import type { SpaceView } from "@mosoo/contracts/space";
import { ArrowLeft, Folder, Lock, Plus, Settings } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

export function SpaceSidebar({
  activeSpaceId,
  canManageSpace,
  getManageDisabledReason,
  hoveredSpaceId,
  onBackToHub,
  onCreateSpace,
  onHoverSpace,
  onOpenSettings,
  onSelectSpace,
  spaces,
  userId,
}: {
  activeSpaceId: string | null;
  canManageSpace: ((space: SpaceView) => boolean) | undefined;
  getManageDisabledReason: ((space: SpaceView) => string | null) | undefined;
  hoveredSpaceId: string | null;
  onBackToHub?: () => void;
  onCreateSpace: () => void;
  onHoverSpace: (spaceId: string | null) => void;
  onOpenSettings: (spaceId: string) => void;
  onSelectSpace: (spaceId: string) => void;
  spaces: SpaceView[];
  userId: string | undefined;
}) {
  const ownedSpaces = spaces.filter((space) => space.ownerId === userId);
  const organizationSpaces = spaces.filter((space) => space.ownerId !== userId);

  return (
    <aside className="border-border-soft flex w-[220px] flex-col border-r">
      {onBackToHub ? (
        <button
          type="button"
          onClick={onBackToHub}
          className="text-fg-3 hover:bg-paper-200/60 hover:text-fg-1 mx-3 mt-3 mb-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          All spaces
        </button>
      ) : null}

      <div className="flex items-center justify-between px-3 pt-1 pb-1">
        <span className="t-eyebrow px-2 py-1">Spaces</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCreateSpace}
          className="text-fg-3 hover:text-accent-press"
          title="New space"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-x-hidden overflow-y-auto px-2">
        {ownedSpaces.length > 0 ? (
          <SpaceSidebarList
            activeSpaceId={activeSpaceId}
            canManageSpace={canManageSpace}
            getManageDisabledReason={getManageDisabledReason}
            hoveredSpaceId={hoveredSpaceId}
            onHoverSpace={onHoverSpace}
            onOpenSettings={onOpenSettings}
            onSelectSpace={onSelectSpace}
            spaces={ownedSpaces}
          />
        ) : null}

        {organizationSpaces.length > 0 ? (
          <>
            <div className="t-eyebrow px-2.5 pt-4 pb-1">All organization spaces</div>
            <SpaceSidebarList
              activeSpaceId={activeSpaceId}
              canManageSpace={canManageSpace}
              getManageDisabledReason={getManageDisabledReason}
              hoveredSpaceId={hoveredSpaceId}
              onHoverSpace={onHoverSpace}
              onOpenSettings={onOpenSettings}
              onSelectSpace={onSelectSpace}
              spaces={organizationSpaces}
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}

function SpaceSidebarList({
  activeSpaceId,
  canManageSpace,
  getManageDisabledReason,
  hoveredSpaceId,
  onHoverSpace,
  onOpenSettings,
  onSelectSpace,
  spaces,
}: {
  activeSpaceId: string | null;
  canManageSpace: ((space: SpaceView) => boolean) | undefined;
  getManageDisabledReason: ((space: SpaceView) => string | null) | undefined;
  hoveredSpaceId: string | null;
  onHoverSpace: (spaceId: string | null) => void;
  onOpenSettings: (spaceId: string) => void;
  onSelectSpace: (spaceId: string) => void;
  spaces: SpaceView[];
}) {
  return spaces.map((space) => (
    <SpaceSidebarItem
      key={space.id}
      active={space.id === activeSpaceId}
      canManage={canManageSpace?.(space) ?? space.role === "admin"}
      disabledManageReason={getManageDisabledReason?.(space) ?? null}
      hovered={hoveredSpaceId === space.id}
      onHover={onHoverSpace}
      onOpenSettings={onOpenSettings}
      onSelect={() => {
        onSelectSpace(space.id);
      }}
      space={space}
    />
  ));
}

function SpaceSidebarItem({
  active,
  canManage,
  disabledManageReason,
  hovered,
  onHover,
  onOpenSettings,
  onSelect,
  space,
}: {
  active: boolean;
  canManage: boolean;
  disabledManageReason: string | null;
  hovered: boolean;
  onHover: (spaceId: string | null) => void;
  onOpenSettings: (spaceId: string) => void;
  onSelect: () => void;
  space: SpaceView;
}) {
  return (
    <div
      className="relative"
      onMouseEnter={() => {
        onHover(space.id);
      }}
      onMouseLeave={() => {
        onHover(null);
      }}
    >
      <Button
        variant="ghost"
        onClick={onSelect}
        className={cn(
          "w-full justify-between h-auto px-2.5 py-2 rounded-md mb-0.5 text-left font-medium",
          active ? "bg-paper-200 text-fg-1 font-bold" : "text-fg-2 hover:text-fg-1",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Folder className="size-4 shrink-0" />
          <span className="flex-1 truncate text-[13px]">{space.name}</span>
          {space.visibility === "private" ? (
            <Lock className="text-fg-muted size-3 shrink-0" />
          ) : null}
        </div>
      </Button>
      {hovered && (canManage || Boolean(disabledManageReason)) ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!canManage) {
              return;
            }
            onOpenSettings(space.id);
          }}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm transition-colors",
            canManage
              ? "text-fg-3 hover:bg-paper-300 hover:text-fg-1"
              : "cursor-not-allowed text-fg-muted opacity-60",
          )}
          aria-disabled={!canManage}
          title={canManage ? "Space settings" : (disabledManageReason ?? undefined)}
        >
          <Settings className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
