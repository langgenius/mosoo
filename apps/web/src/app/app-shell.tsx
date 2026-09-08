import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import ChevronsDownUpIcon from "@hugeicons/core-free-icons/ChevronsDownUpIcon";
import PanelLeftCloseIcon from "@hugeicons/core-free-icons/PanelLeftCloseIcon";
import PanelLeftOpenIcon from "@hugeicons/core-free-icons/PanelLeftOpenIcon";
import type { ProjectSummary } from "@mosoo/contracts/project";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { HelpMenu } from "@/features/help/help-menu";
import { useTranslation } from "@/shared/i18n";
import { LocaleSwitcher } from "@/shared/i18n/locale-switcher";
import { getAvatarInitial } from "@/shared/lib/avatar";
import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";
import { SidebarRow, SidebarTooltip } from "@/shared/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";

import { AccountMenu } from "./account-menu";
import { createHugeicon } from "./hugeicon";
import { ProjectNavigation } from "./navigation";
import { OrgNavigation } from "./org-navigation";
import { useAppSession } from "./session-provider";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

const BackIcon = createHugeicon(ArrowLeft01Icon, "BackIcon");
const CheckmarkIcon = createHugeicon(CheckIcon, "CheckmarkIcon");
const CollapseSidebarIcon = createHugeicon(PanelLeftCloseIcon, "CollapseSidebarIcon");
const ExpandSidebarIcon = createHugeicon(PanelLeftOpenIcon, "ExpandSidebarIcon");
const NewAgentIcon = createHugeicon(Add01Icon, "NewAgentIcon");
const SwitcherChevronIcon = createHugeicon(ChevronsDownUpIcon, "SwitcherChevronIcon");

// Both console sidebars share one width so the Org and Project layers line up.
const SIDEBAR_WIDTH_CLASS = "w-[240px]";
const SIDEBAR_RAIL_WIDTH_CLASS = "w-[64px]";

const ICON_BUTTON_CLASS =
  "text-fg-3 hover:bg-sidebar-row-hover hover:text-fg-1 focus-visible:ring-ring focus-visible:ring-offset-sidebar flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1";

// Project identity for the switcher and the icon-only rail: a neutral monogram
// tile keeps the active Project recognisable once its label is gone, without a
// second coloured avatar competing with the account row.
function ProjectMonogram({
  name,
  size = "sm",
}: {
  name: string | null;
  size?: "md" | "sm";
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-sidebar-row-active text-fg-1 flex shrink-0 items-center justify-center rounded-[6px] font-bold tracking-[0.02em] select-none",
        size === "md" ? "size-6 text-[11px]" : "size-5 text-[10px]",
      )}
    >
      {getAvatarInitial(name)}
    </span>
  );
}

// Return to the parent Org layer (the Projects list). It lives in the switcher
// menu so the top of the sidebar stays a single identity row.
function BackToOrgLink({ orgName }: { orgName: string | null }): ReactElement {
  const { t } = useTranslation();
  const label = t("nav.backTo", { label: orgName ?? t("pageTitle.projects") });

  return (
    <DropdownMenuItem asChild className="cursor-pointer gap-2 rounded-md">
      <Link to="/projects">
        <BackIcon className="text-fg-3 size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </Link>
    </DropdownMenuItem>
  );
}

// Project switcher: the active Project's identity row; the menu switches
// Projects inline and offers the way back to the Org layer.
function ProjectSwitcher({
  activeProject,
  collapsed,
  loading,
  onSwitch,
  orgName,
  projects,
}: {
  activeProject: ProjectSummary | null;
  collapsed: boolean;
  loading: boolean;
  onSwitch: (projectId: string) => void;
  orgName: string | null;
  projects: ProjectSummary[];
}): ReactElement {
  const { t } = useTranslation();
  const displayLabel =
    activeProject?.name ?? (loading ? t("common.loadingProject") : t("common.noProject"));
  const accessibleName = `${t("projects.switchProject")}: ${displayLabel}`;

  const trigger = (
    <button
      type="button"
      aria-label={accessibleName}
      className={cn(
        "hover:bg-sidebar-row-hover focus-visible:ring-ring focus-visible:ring-offset-sidebar data-[popup-open]:bg-sidebar-row-active flex shrink-0 items-center rounded-md outline-none transition-[background-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1",
        collapsed ? "mx-auto size-8 justify-center" : "h-9 w-full gap-2.5 px-2 text-left",
      )}
    >
      <ProjectMonogram name={activeProject?.name ?? null} size={collapsed ? "md" : "sm"} />
      {collapsed ? null : (
        <>
          <span className="sidebar-label-enter text-fg-1 min-w-0 flex-1 truncate text-[13px] leading-none font-semibold">
            {displayLabel}
          </span>
          <SwitcherChevronIcon className="sidebar-label-enter text-fg-3 size-3.5 shrink-0" />
        </>
      )}
    </button>
  );

  return (
    <DropdownMenu>
      <SidebarTooltip collapsed={collapsed} label={displayLabel}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      </SidebarTooltip>
      <DropdownMenuContent
        align="start"
        side={collapsed ? "right" : "bottom"}
        sideOffset={6}
        className="w-[232px] rounded-lg p-1"
      >
        <DropdownMenuLabel className="text-fg-3 px-2 py-1 text-[10.5px] font-semibold tracking-[0.06em] uppercase">
          {t("pageTitle.projects")}
        </DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            className="cursor-pointer gap-2 rounded-md"
            onSelect={() => onSwitch(project.id)}
          >
            <ProjectMonogram name={project.name} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {activeProject !== null && project.id === activeProject.id ? (
              <CheckmarkIcon className="text-fg-1 size-4 shrink-0" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <BackToOrgLink orgName={orgName} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// "Create agent" is a quick action, not a destination, so it reads as the first
// row of the work list rather than a filled button competing with the content.
function NewAgentAction({
  collapsed,
  disabled,
}: {
  collapsed: boolean;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const label = t("agent.create");

  if (disabled) {
    return <SidebarRow collapsed={collapsed} disabled icon={NewAgentIcon} label={label} />;
  }

  return (
    <SidebarRow
      className="text-fg-1"
      collapsed={collapsed}
      icon={NewAgentIcon}
      label={label}
      to="/agent?create=1"
    />
  );
}

function SidebarHeader({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const ToggleIcon = collapsed ? ExpandSidebarIcon : CollapseSidebarIcon;
  const toggleLabel = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");

  const toggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          className={ICON_BUTTON_CLASS}
        >
          <ToggleIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{toggleLabel}</TooltipContent>
    </Tooltip>
  );

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 pt-3 pb-2">
        <img src="/brand/logo-mark.svg" alt="mosoo" className="block size-6" />
        {toggle}
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center justify-between pr-0.5 pl-2">
      <img
        src="/brand/logo-wordmark-onlight.svg"
        alt="mosoo"
        className="sidebar-label-enter block h-5"
      />
      {toggle}
    </div>
  );
}

// Lower persistent area: infrequent but always-available entry points. It never
// shrinks, so it stays reachable however long the work list above it grows.
function ConsoleSidebarFooter({
  children,
  collapsed,
  helpShortcutEnabled = true,
}: {
  children?: ReactNode;
  collapsed: boolean;
  helpShortcutEnabled?: boolean;
}): ReactElement {
  const { user } = useAppSession();

  return (
    <div
      data-sidebar-zone="persistent"
      className="border-border-soft flex shrink-0 flex-col border-t pt-2"
    >
      <div className="flex flex-col gap-0.5">
        {children}
        <HelpMenu collapsed={collapsed} shortcutEnabled={helpShortcutEnabled} />
        <LocaleSwitcher collapsed={collapsed} />
      </div>
      <AccountMenu collapsed={collapsed} user={user} />
    </div>
  );
}

function MobileNavigation({
  footer,
  renderNavigation,
  title,
}: {
  footer?: ReactNode;
  renderNavigation: (closeNavigation: () => void) => ReactNode;
  title?: string | null;
}): ReactElement {
  const location = useLocation();
  const { t } = useTranslation();
  const navigationLocation = `${location.pathname}${location.search}`;
  const [openedAtLocation, setOpenedAtLocation] = useState<string | null>(null);
  const open = openedAtLocation === navigationLocation;

  function closeNavigation(): void {
    setOpenedAtLocation(null);
  }

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") {
      return;
    }

    const desktopBreakpoint = globalThis.matchMedia("(min-width: 768px)");

    function handleBreakpointChange(event: MediaQueryListEvent): void {
      if (event.matches) {
        setOpenedAtLocation(null);
      }
    }

    desktopBreakpoint.addEventListener("change", handleBreakpointChange);
    return () => {
      desktopBreakpoint.removeEventListener("change", handleBreakpointChange);
    };
  }, []);

  return (
    <div className="md:hidden">
      <header className="border-border-soft bg-background flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <button
          aria-label={t("projects.openNavigation")}
          className="text-fg-2 hover:bg-sidebar-row-hover hover:text-fg-1 flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 transition-colors"
          onClick={() => {
            setOpenedAtLocation(navigationLocation);
          }}
          type="button"
        >
          <ExpandSidebarIcon className="size-5" />
          <span className="text-xs font-semibold">{t("common.menu")}</span>
        </button>
        <img src="/brand/logo-wordmark-onlight.svg" alt="mosoo" className="block h-5" />
        {title ? (
          <h1 className="text-fg-1 ml-auto truncate text-sm font-semibold">{title}</h1>
        ) : null}
      </header>

      <Sheet
        onOpenChange={(nextOpen) => {
          setOpenedAtLocation(nextOpen ? navigationLocation : null);
        }}
        open={open}
      >
        <SheetContent
          side="left"
          className="bg-sidebar flex w-[min(20rem,calc(100vw-2rem))] max-w-none flex-col p-3"
        >
          <SheetTitle className="sr-only">{t("common.navigation")}</SheetTitle>
          <div className="flex h-11 shrink-0 items-center px-2">
            <img src="/brand/logo-wordmark-onlight.svg" alt="mosoo" className="block h-5" />
          </div>
          <nav
            className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 [&_[aria-disabled]]:min-h-11 [&_a]:min-h-11 [&_button]:min-h-11"
            onClickCapture={(event) => {
              if (event.target instanceof Element && event.target.closest("a") !== null) {
                closeNavigation();
              }
            }}
          >
            {renderNavigation(closeNavigation)}
            <div className="min-h-4 flex-1" />
            <ConsoleSidebarFooter collapsed={false} helpShortcutEnabled={false}>
              {footer}
            </ConsoleSidebarFooter>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const ORG_HEADER_TITLES = [
  { path: "/projects", titleKey: "pageTitle.projects" },
  { path: "/org/settings", titleKey: "pageTitle.orgSettings" },
] as const;

function getOrgHeaderTitle(pathname: string): string | null {
  return (
    ORG_HEADER_TITLES.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
      ?.titleKey ?? null
  );
}

// Shared console chrome. The desktop sidebar stacks a fixed top (brand header
// plus the optional `identity` row), a scrolling work area (the `sidebar` slot),
// and the anchored persistent footer (help, language, account, plus the layer's
// `footer` rows). The content area and the mobile drawer are the same for the
// Project and Org layers.
function ConsoleShell({
  children,
  collapsed,
  footer,
  identity,
  mobileSidebar,
  onToggleCollapsed,
  sidebar,
}: {
  children: ReactNode;
  collapsed: boolean;
  footer?: ReactNode;
  /** Non-scrolling identity row under the brand header (the Project switcher). */
  identity?: ReactNode;
  mobileSidebar: (closeNavigation: () => void) => ReactNode;
  onToggleCollapsed: () => void;
  sidebar: ReactNode;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="bg-sidebar flex h-dvh">
      <nav
        aria-label={t("common.navigation")}
        className={cn(
          "bg-sidebar hidden shrink-0 flex-col px-3 transition-[width] duration-200 ease-out md:flex",
          collapsed ? SIDEBAR_RAIL_WIDTH_CLASS : SIDEBAR_WIDTH_CLASS,
        )}
      >
        <SidebarHeader collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
        {identity === undefined ? null : <div className="shrink-0 pb-1">{identity}</div>}
        <div
          data-sidebar-zone="work"
          className="sidebar-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-2 pb-3"
        >
          {sidebar}
        </div>
        <ConsoleSidebarFooter collapsed={collapsed}>{footer}</ConsoleSidebarFooter>
      </nav>

      <div className="flex min-w-0 flex-1">
        <main className="bg-background md:border-border-soft flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-md md:border-l">
          <MobileNavigation footer={footer} renderNavigation={mobileSidebar} />
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </main>
      </div>
    </div>
  );
}

// Project-layer shell: scoped to the active Project's resources.
export function Layout({ children }: { children: ReactNode }): ReactElement {
  const { activeProject, activeOrganization, projects, projectsLoading, setActiveProject } =
    useAppSession();
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  function switchProject(projectId: string): void {
    setActiveProject(projectId);
    void navigate("/");
  }

  function projectIdentity(isCollapsed: boolean, onNavigate?: () => void): ReactNode {
    return (
      <ProjectSwitcher
        activeProject={activeProject}
        collapsed={isCollapsed}
        loading={projectsLoading}
        orgName={activeOrganization?.name ?? null}
        projects={projects}
        onSwitch={(projectId) => {
          switchProject(projectId);
          onNavigate?.();
        }}
      />
    );
  }

  function projectWork(isCollapsed: boolean): ReactNode {
    return (
      <>
        <NewAgentAction collapsed={isCollapsed} disabled={activeProject === null} />
        <div className="mt-2">
          <ProjectNavigation collapsed={isCollapsed} pathname={location.pathname} />
        </div>
      </>
    );
  }

  // Mobile drawer: identity row and work list stacked, always expanded.
  function projectDrawer(onNavigate: () => void): ReactNode {
    return (
      <>
        <div className="pb-2">{projectIdentity(false, onNavigate)}</div>
        {projectWork(false)}
      </>
    );
  }

  function projectFooter(isCollapsed: boolean): ReactNode {
    return (
      <ProjectNavigation collapsed={isCollapsed} pathname={location.pathname} zone="persistent" />
    );
  }

  return (
    <TooltipProvider>
      <ConsoleShell
        collapsed={collapsed}
        footer={projectFooter(collapsed)}
        identity={projectIdentity(collapsed)}
        mobileSidebar={(closeNavigation) => projectDrawer(closeNavigation)}
        onToggleCollapsed={toggleCollapsed}
        sidebar={projectWork(collapsed)}
      >
        {children}
      </ConsoleShell>
    </TooltipProvider>
  );
}

// Org-layer shell: a horizontal top bar (logo + org name) over a dedicated Org
// sidebar. Deliberately distinct from the Project shell so the Projects list /
// pre-Project console reads as the account layer, not a Project detail page.
export function OrgLayout({ children }: { children: ReactNode }): ReactElement {
  const { t } = useTranslation();
  const { activeOrganization } = useAppSession();
  const location = useLocation();
  const headerTitle = getOrgHeaderTitle(location.pathname);
  const resolvedHeaderTitle = headerTitle === null ? null : t(headerTitle);

  return (
    <TooltipProvider>
      <div className="bg-background flex h-dvh flex-col">
        <header className="border-border-soft hidden shrink-0 border-b md:flex">
          <div
            className={cn(
              "bg-sidebar border-border-soft flex min-h-[76px] shrink-0 items-center gap-2 border-r px-4",
              SIDEBAR_WIDTH_CLASS,
            )}
          >
            <Link to="/projects" aria-label={t("pageTitle.projects")} className="flex items-center">
              <img src="/brand/logo-mark.svg" alt="mosoo" className="block size-6" />
            </Link>
            {activeOrganization === null ? null : (
              <>
                <span className="text-fg-muted text-base font-light">/</span>
                <span className="text-foreground max-w-[144px] truncate text-sm font-semibold">
                  {activeOrganization.name}
                </span>
              </>
            )}
          </div>
          {resolvedHeaderTitle === null ? null : (
            <div className="flex min-w-0 flex-1 items-center px-8">
              <h1 className="text-foreground truncate text-2xl font-semibold tracking-normal">
                {resolvedHeaderTitle}
              </h1>
            </div>
          )}
        </header>
        <MobileNavigation
          renderNavigation={() => <OrgNavigation collapsed={false} pathname={location.pathname} />}
          title={resolvedHeaderTitle}
        />
        <div className="flex min-h-0 flex-1">
          <aside className="bg-sidebar border-border-soft hidden w-[240px] shrink-0 flex-col border-r px-3 md:flex">
            <div
              data-sidebar-zone="work"
              className="sidebar-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-4 pb-3"
            >
              <OrgNavigation collapsed={false} pathname={location.pathname} />
            </div>
            <ConsoleSidebarFooter collapsed={false} />
          </aside>
          <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
