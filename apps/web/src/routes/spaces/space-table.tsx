import { Folder, Lock, Settings } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import type { SpaceListViewProps } from "./space-list-view-props";

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
