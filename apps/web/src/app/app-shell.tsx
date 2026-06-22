import type { AppSummary } from "@mosoo/contracts/app";
import {
  Box,
  Check,
  ChevronLeft,
  ChevronsUpDown,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { HelpMenu } from "@/features/help/help-menu";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { AccountMenu } from "./account-menu";
import { AppNavigation } from "./navigation";
import { OrgNavigation } from "./org-navigation";
import { useAppSession } from "./session-provider";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

// One-click return to the parent Org layer (the Apps list).
function BackToOrgLink({ collapsed, orgName }: { collapsed: boolean; orgName: string | null }) {
  const label = orgName ?? "Apps";
  const link = (
    <Link
      to="/apps"
      aria-label={`Back to ${label}`}
      className={cn(
        "text-fg-3 hover:text-fg-1 flex items-center gap-1 rounded-md transition-colors",
        collapsed
          ? "mx-auto mb-1 size-9 justify-center"
          : "mx-0.5 mb-1.5 px-1.5 py-1 text-[12px] font-medium",
      )}
    >
      <ChevronLeft className="size-3.5 shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">Back to {label}</TooltipContent>
    </Tooltip>
  );
}

// App switcher: shows the active App and switches Apps inline via a dropdown,
// plus shortcuts to manage Apps and open App settings.
function AppSwitcher({
  activeApp,
  apps,
  collapsed,
  loading,
  onSwitch,
}: {
  activeApp: AppSummary | null;
  apps: AppSummary[];
  collapsed: boolean;
  loading: boolean;
  onSwitch: (appId: string) => void;
}) {
  const displayLabel = activeApp?.name ?? (loading ? "Loading app" : "No app");

  const trigger = (
    <button
      type="button"
      aria-label="Switch app"
      className={cn(
        "border-border bg-background text-foreground hover:border-border-strong flex items-center rounded-md border text-[13px] font-semibold transition-colors",
        collapsed ? "mx-auto mb-3 size-9 justify-center" : "mx-0.5 mb-4 gap-2 px-2.5 py-2",
      )}
    >
      <Box className="size-4 shrink-0" />
      {collapsed ? null : (
        <>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-muted-foreground text-[10.5px] leading-3 font-semibold uppercase">
              App
            </div>
            <div className="truncate">{displayLabel}</div>
          </div>
          <ChevronsUpDown className="text-fg-3 size-3.5 shrink-0" />
        </>
      )}
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={collapsed ? "right" : "bottom"}
        className="w-[224px] rounded-lg p-1"
      >
        <DropdownMenuLabel className="text-fg-3 px-2 py-1 text-[10.5px] font-semibold tracking-wider uppercase">
          Apps
        </DropdownMenuLabel>
        {apps.map((app) => (
          <DropdownMenuItem
            key={app.id}
            className="cursor-pointer gap-2 rounded-md"
            onSelect={() => onSwitch(app.id)}
          >
            <Box className="text-fg-3 size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{app.name}</span>
            {activeApp !== null && app.id === activeApp.id ? (
              <Check className="text-accent-press size-4 shrink-0" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer rounded-md">
          <Link to="/apps">
            <LayoutGrid className="size-4" />
            Manage apps
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer rounded-md">
          <Link to="/settings/app">
            <Settings className="size-4" />
            App settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewAgentCta({ collapsed, disabled }: { collapsed: boolean; disabled: boolean }) {
  const className = cn("mb-4", collapsed ? "mx-auto size-9 p-0" : "w-full justify-center");
  const label = "New agent";

  if (disabled) {
    return (
      <Button disabled aria-label={label} className={className}>
        <Plus className="size-4" />
        {collapsed ? null : label}
      </Button>
    );
  }

  const cta = (
    <Button asChild aria-label={label} className={className}>
      <Link to="/agent?create=1">
        <Plus className="size-4" />
        {collapsed ? null : label}
      </Link>
    </Button>
  );

  if (!collapsed) {
    return cta;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cta}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ConsoleSidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { user } = useAppSession();

  return (
    <>
      <div className={cn("pb-2", collapsed ? "flex justify-center" : "px-0.5")}>
        <HelpMenu collapsed={collapsed} />
      </div>
      <Separator className="bg-border-soft" />
      <AccountMenu collapsed={collapsed} user={user} />
    </>
  );
}

// Shared console chrome (brand, collapse toggle, help, account, content area).
// The middle `sidebar` slot is what differs between the App and Org layers.
function ConsoleShell({
  children,
  collapsed,
  onToggleCollapsed,
  sidebar,
}: {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sidebar: ReactNode;
}) {
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
                onClick={onToggleCollapsed}
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

        {sidebar}

        <div className="flex-1" />
        <ConsoleSidebarFooter collapsed={collapsed} />
      </nav>

      <div className="flex min-w-0 flex-1 md:py-2 md:pr-2">
        <main className="bg-background md:border-border-soft flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-xl md:border md:shadow-sm">
          {children}
        </main>
      </div>
    </div>
  );
}

// App-layer shell: scoped to the active App's resources.
export function Layout({ children }: { children: ReactNode }) {
  const { activeApp, activeOrganization, apps, appsLoading, setActiveApp } = useAppSession();
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  function switchApp(appId: string) {
    setActiveApp(appId);
    void navigate("/");
  }

  return (
    <ConsoleShell
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      sidebar={
        <>
          <BackToOrgLink collapsed={collapsed} orgName={activeOrganization?.name ?? null} />
          <AppSwitcher
            activeApp={activeApp}
            apps={apps}
            collapsed={collapsed}
            loading={appsLoading}
            onSwitch={switchApp}
          />
          <NewAgentCta collapsed={collapsed} disabled={activeApp === null} />
          <AppNavigation collapsed={collapsed} pathname={location.pathname} />
        </>
      }
    >
      {children}
    </ConsoleShell>
  );
}

// Org-layer shell: a horizontal top bar (logo + org name) over a
// dedicated Org sidebar. Deliberately distinct from the App shell so the Apps
// list / pre-App console reads as the account layer, not an App detail page.
export function OrgLayout({ children }: { children: ReactNode }) {
  const { activeOrganization } = useAppSession();
  const location = useLocation();

  return (
    <div className="bg-background flex h-screen flex-col">
      <header className="border-border-soft flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Link to="/apps" aria-label="Apps" className="flex items-center">
          <img src="/brand/logo-mark.svg" alt="Mosoo" className="block size-6" />
        </Link>
        {activeOrganization === null ? null : (
          <>
            <span className="text-fg-muted text-base font-light">/</span>
            <span className="text-foreground max-w-[240px] truncate text-sm font-semibold">
              {activeOrganization.name}
            </span>
          </>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="border-border-soft flex w-[224px] shrink-0 flex-col border-r px-3 py-4">
          <OrgNavigation collapsed={false} pathname={location.pathname} />
          <div className="flex-1" />
          <ConsoleSidebarFooter collapsed={false} />
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
