import { Box, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { HelpMenu } from "@/features/help/help-menu";
import { cn } from "@/shared/lib/class-names";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { AccountMenu } from "./account-menu";
import { AppNavigation } from "./navigation";
import { useAppSession } from "./session-provider";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

function AppScopePill({
  collapsed,
  label,
  loading,
}: {
  collapsed: boolean;
  label: string | null;
  loading: boolean;
}) {
  const displayLabel = label ?? (loading ? "Loading app" : "No app");
  const pill = (
    <div
      className={cn(
        "border-border bg-background text-foreground flex items-center rounded-md border text-[13px] font-semibold",
        collapsed ? "mx-auto mb-3 size-9 justify-center" : "mx-0.5 mb-4 gap-2 px-2.5 py-2",
      )}
    >
      <Box className="size-4 shrink-0" />
      {collapsed ? null : (
        <div className="min-w-0">
          <div className="text-muted-foreground text-[10.5px] leading-3 font-semibold uppercase">
            App
          </div>
          <div className="truncate">{displayLabel}</div>
        </div>
      )}
    </div>
  );

  if (!collapsed) {
    return pill;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="right">{displayLabel}</TooltipContent>
    </Tooltip>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { activeApp, appsLoading, user } = useAppSession();
  const location = useLocation();
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <div className="bg-sidebar flex h-screen">
      <nav
        className={cn(
          "hidden shrink-0 flex-col bg-sidebar pt-3.5 transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-[64px] px-2" : "w-[240px] px-3",
        )}
      >
        <div
          className={cn(
            "flex items-center px-1.5 pt-1 pb-2.5",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {collapsed ? null : (
            <img src="/brand/logo-wordmark-onlight.svg" alt="Mosoo" className="block h-[22px]" />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={toggleLabel}
                aria-pressed={collapsed}
                className="text-fg-3 hover:bg-ink-900/[0.04] hover:text-fg-1 flex size-7 items-center justify-center rounded-md transition-colors"
              >
                <ToggleIcon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{toggleLabel}</TooltipContent>
          </Tooltip>
        </div>

        <AppScopePill collapsed={collapsed} label={activeApp?.name ?? null} loading={appsLoading} />

        <AppNavigation collapsed={collapsed} pathname={location.pathname} />

        <div className="flex-1" />
        <div className={cn("pb-2", collapsed ? "flex justify-center" : "px-0.5")}>
          <HelpMenu collapsed={collapsed} />
        </div>
        <Separator className="bg-border-soft" />
        <AccountMenu collapsed={collapsed} user={user} />
      </nav>

      <div className="flex min-w-0 flex-1 md:py-2 md:pr-2">
        <main className="bg-background md:border-border-soft flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-xl md:border md:shadow-sm">
          {children}
        </main>
      </div>
    </div>
  );
}
