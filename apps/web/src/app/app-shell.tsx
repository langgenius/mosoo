import { Permission, can } from "@mosoo/contracts/permission";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { AccountMenu } from "./account-menu";
import { AppNavigation } from "./navigation";
import { OrganizationSwitcher } from "./organization-switcher";
import { useAppSession } from "./session-provider";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

export function Layout({ children }: { children: ReactNode }) {
  const { activeOrganization, user } = useAppSession();
  const location = useLocation();
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();
  const canReadGovernance = can(activeOrganization?.viewerRole, Permission.CostOrganizationRead);

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

        <OrganizationSwitcher collapsed={collapsed} />

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/threads?compose=1"
              aria-label="New thread"
              className={cn(
                "bg-primary text-primary-foreground hover:bg-primary-hover mt-1 inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold shadow-xs transition-colors",
                collapsed ? "mx-auto size-9 rounded-md" : "mx-0.5 mb-4 h-9 rounded-lg px-3",
              )}
            >
              <Plus className="size-3.5" />
              {collapsed ? null : <span>New thread</span>}
            </Link>
          </TooltipTrigger>
          {collapsed ? <TooltipContent side="right">New thread</TooltipContent> : null}
        </Tooltip>

        <AppNavigation
          canReadGovernance={canReadGovernance}
          collapsed={collapsed}
          pathname={location.pathname}
        />

        <div className="flex-1" />
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
