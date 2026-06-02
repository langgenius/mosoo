import type { SpaceView } from "@mosoo/contracts/space";
import { Folder, Lock, Plus, Search, Settings } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import type { Scope } from "@/shared/ui/scope-tabs";

interface SpaceListViewProps {
  spaces: SpaceView[];
  canManageSpace: (space: SpaceView) => boolean;
  getManageDisabledReason: (space: SpaceView) => string | null;
  onSelectSpace: (spaceId: string) => void;
  onOpenSettings: (spaceId: string) => void;
}

export function SpacesEmptyState({
  onCreateSpace,
  scope,
  searching,
}: {
  onCreateSpace: () => void;
  scope: Scope;
  searching: boolean;
}): ReactElement {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matching spaces"
        description="Try a different search term."
      />
    );
  }

  if (scope === "shared") {
    return (
      <EmptyState
        icon={Folder}
        title="No spaces shared with you yet"
        description="Spaces shared with you by teammates will appear here."
      />
    );
  }

  if (scope === "organization") {
    return (
      <EmptyState
        icon={Folder}
        title="No organization spaces"
        description="Spaces created by anyone in this organization will appear here."
      />
    );
  }

  return (
    <EmptyState
      icon={Folder}
      title="No spaces yet"
      description="Create a Space to share files with Agents and teammates."
      action={
        <Button onClick={onCreateSpace} size="sm">
          <Plus className="size-3.5" />
          New space
        </Button>
      }
    />
  );
}

export function SpaceTable({
  spaces,
  canManageSpace,
  getManageDisabledReason,
  onSelectSpace,
  onOpenSettings,
}: SpaceListViewProps): ReactElement {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border grid h-10 grid-cols-[1fr_120px_140px_48px] items-center border-b px-4">
        <span className="text-fg-3 text-[11px] font-semibold tracking-[0.1em] uppercase">
          Space
        </span>
        <span className="text-fg-3 text-[11px] font-semibold tracking-[0.1em] uppercase">
          Visibility
        </span>
        <span className="text-fg-3 text-[11px] font-semibold tracking-[0.1em] uppercase">
          Created
        </span>
        <span />
      </div>
      {spaces.map((space, index) => {
        const canManage = canManageSpace(space);
        const disabledReason = getManageDisabledReason(space);

        return (
          <div
            key={space.id}
            className={cn(
              "grid h-14 grid-cols-[1fr_120px_140px_48px] items-center px-4 transition-colors hover:bg-paper-50",
              index !== spaces.length - 1 && "border-b border-border-soft",
            )}
          >
            <button
              aria-label={`Open ${space.name}`}
              className="contents cursor-pointer text-left"
              onClick={() => {
                onSelectSpace(space.id);
              }}
              type="button"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="bg-paper-200 text-fg-2 flex size-8 shrink-0 items-center justify-center rounded-md">
                  <Folder className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-fg-1 truncate text-[14px] font-semibold">{space.name}</div>
                </div>
              </div>
              <div className="text-fg-2 flex items-center gap-1.5 text-[12px]">
                {space.visibility === "private" ? (
                  <>
                    <Lock className="size-3" />
                    <span>Private</span>
                  </>
                ) : (
                  <span>Shared</span>
                )}
              </div>
              <span className="text-fg-3 font-mono text-[12px]" suppressHydrationWarning>
                {new Date(space.createdAt).toLocaleDateString()}
              </span>
            </button>
            {canManage || Boolean(disabledReason) ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (canManage) {
                    onOpenSettings(space.id);
                  }
                }}
                aria-disabled={!canManage}
                title={canManage ? "Space settings" : (disabledReason ?? undefined)}
                tabIndex={canManage ? 0 : -1}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md transition-colors",
                  canManage
                    ? "text-fg-3 hover:bg-paper-200 hover:text-fg-1"
                    : "text-fg-muted cursor-not-allowed opacity-60",
                )}
                aria-label="Space settings"
              >
                <Settings className="size-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SpaceGrid({
  spaces,
  canManageSpace,
  getManageDisabledReason,
  onSelectSpace,
  onOpenSettings,
}: SpaceListViewProps): ReactElement {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {spaces.map((space) => {
        const canManage = canManageSpace(space);
        const disabledReason = getManageDisabledReason(space);

        return (
          <div
            key={space.id}
            className="group border-border bg-card hover:border-border-strong relative cursor-pointer rounded-lg border p-4 transition-all"
            style={{ boxShadow: "var(--shadow-xs)" }}
          >
            <button
              aria-label={`Open ${space.name}`}
              className="focus-visible:ring-ring absolute inset-0 z-10 rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              onClick={() => {
                onSelectSpace(space.id);
              }}
              type="button"
            />
            <div className="mb-3 flex items-start justify-between">
              <div className="bg-paper-200 text-fg-2 flex size-10 items-center justify-center rounded-md">
                <Folder className="size-5" />
              </div>
              {canManage || Boolean(disabledReason) ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canManage) {
                      onOpenSettings(space.id);
                    }
                  }}
                  aria-disabled={!canManage}
                  title={canManage ? "Space settings" : (disabledReason ?? undefined)}
                  tabIndex={canManage ? 0 : -1}
                  className={cn(
                    "relative z-20 inline-flex size-7 items-center justify-center rounded-md opacity-0 transition-colors group-hover:opacity-100",
                    canManage
                      ? "text-fg-3 hover:bg-paper-200 hover:text-fg-1"
                      : "text-fg-muted cursor-not-allowed",
                  )}
                  aria-label="Space settings"
                >
                  <Settings className="size-3.5" />
                </button>
              ) : null}
            </div>
            <h3 className="text-fg-1 mb-1 truncate text-[14.5px] font-semibold">{space.name}</h3>
            <div className="text-fg-3 flex items-center gap-1.5 text-[12px]">
              {space.visibility === "private" ? (
                <>
                  <Lock className="size-3" />
                  <span>Private</span>
                </>
              ) : (
                <span>Shared</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
