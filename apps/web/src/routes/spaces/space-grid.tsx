import { Folder, Lock, Settings } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import type { SpaceListViewProps } from "./space-list-view-props";

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
