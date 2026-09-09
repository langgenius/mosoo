import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import PanelLeftCloseIcon from "@hugeicons/core-free-icons/PanelLeftCloseIcon";
import PanelLeftOpenIcon from "@hugeicons/core-free-icons/PanelLeftOpenIcon";
import type { ProjectSummary } from "@mosoo/contracts/project";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { HelpMenu } from "@/features/help/help-menu";
import { useTranslation } from "@/shared/i18n";
import { LocaleSwitcher } from "@/shared/i18n/locale-switcher";
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
import { SidebarTooltip } from "@/shared/ui/sidebar";
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
const SwitcherChevronIcon = createHugeicon(ChevronDownIcon, "SwitcherChevronIcon");

// Both console sidebars share one width so the Org and Project layers line up.
const SIDEBAR_WIDTH_CLASS = "w-[240px]";
const SIDEBAR_RAIL_WIDTH_CLASS = "w-[64px]";

const ICON_BUTTON_CLASS =
  "text-fg-3 hover:bg-sidebar-row-hover hover:text-fg-1 focus-visible:ring-ring focus-visible:ring-offset-sidebar flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1";

// Brand mark used as the identity tile. The sidebar references put the tenant's
// logo tile at the head of the sidebar; here the mark is the constant, the
// Project name beside it is the variable, so "which product, which Project" is
// one glance. Decorative: the trigger's accessible name carries the Project.
function BrandTile({ className }: { className?: string }): ReactElement {
  return (
    <img
      src="/brand/logo-mark.svg"
      alt=""
      aria-hidden="true"
      className={cn("block size-6 shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

// Return to the parent Org layer (the Projects list). It lives in the switcher
// menu so the top of the sidebar stays a single identity row.
function BackToOrgLink({ orgName }: { orgName: string | null }): ReactElement {
  const { t } = useTranslation();
  const label = t("nav.backTo", { label: orgName ?? t("pageTitle.projects") });

  return (
    <DropdownMenuItem asChild className="text-fg-2 cursor-pointer gap-2">
      <Link to="/projects">
        <BackIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </Link>
    </DropdownMenuItem>
  );
}

// Project switcher = the identity row at the head of the sidebar: brand tile,
// Project name, and a chevron that hugs the name (the tenant row from the
// sidebar references), sharing the header line with the collapse toggle. No
// border: the hover fill wraps only the tile and name, so it reads as a title
// with a disclosure rather than a form control. In the rail the tile alone is
// the trigger. The menu switches Projects inline and offers the way back to
// the Org layer.
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
      data-slot="project-switcher"
      className={cn(
        "hover:bg-sidebar-row-hover data-[popup-open]:bg-sidebar-row-active focus-visible:ring-ring focus-visible:ring-offset-sidebar flex h-8 shrink-0 items-center rounded-md outline-none transition-[background-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1",
        collapsed ? "w-8 justify-center" : "min-w-0 max-w-full gap-1.5 pr-2 pl-1.5 text-left",
      )}
    >
      <BrandTile />
      {collapsed ? null : (
        <>
          <span className="sidebar-label-enter text-fg-1 min-w-0 truncate text-[13px] leading-none font-semibold">
            {displayLabel}
          </span>
          <SwitcherChevronIcon className="sidebar-label-enter text-fg-3 -ml-0.5 size-3.5 shrink-0" />
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
        sideOffset={collapsed ? 8 : 4}
        className="w-[216px]"
      >
        <DropdownMenuLabel>{t("pageTitle.projects")}</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            className="cursor-pointer"
            onSelect={() => onSwitch(project.id)}
          >
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

// "Create agent" is the one filled control in the sidebar. It stays black
// through its own token (not --primary, so a palette change cannot recolour
// it), and everything around it stays quiet so the call to action is unmistakable.
const NEW_AGENT_CLASS =
  "focus-visible:ring-ring focus-visible:ring-offset-sidebar flex h-8 shrink-0 items-center justify-center gap-2 rounded-md text-[13px] leading-none font-semibold outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1 [&_svg]:size-4 [&_svg]:shrink-0";

function NewAgentAction({
  collapsed,
  disabled,
}: {
  collapsed: boolean;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const label = t("agent.create");
  const layout = collapsed ? "mx-auto w-8" : "w-full px-3";
  const body = (
    <>
      <NewAgentIcon />
      {collapsed ? null : <span className="sidebar-label-enter truncate">{label}</span>}
    </>
  );

  if (disabled) {
    return (
      <SidebarTooltip collapsed={collapsed} label={label}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={collapsed ? label : undefined}
          className={cn(
            NEW_AGENT_CLASS,
            layout,
            "bg-sidebar-row-active text-fg-muted cursor-not-allowed",
          )}
        >
          {body}
        </button>
      </SidebarTooltip>
    );
  }

  return (
    <SidebarTooltip collapsed={collapsed} label={label}>
      <Link
        to="/agent?create=1"
        aria-label={collapsed ? label : undefined}
        className={cn(
          NEW_AGENT_CLASS,
          layout,
          "bg-sidebar-cta text-sidebar-cta-fg hover:bg-sidebar-cta-hover shadow-xs",
        )}
      >
        {body}
      </Link>
    </SidebarTooltip>
  );
}

// Fixed header line: the identity row (Project switcher) on the left, the
// collapse toggle on the right; the rail stacks the same two controls. Without
// an identity (no Project layer) the brand wordmark stands in.
function SidebarHeader({
  collapsed,
  identity,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  identity?: ReactNode;
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
        {identity ?? <BrandTile className="my-1" />}
        {toggle}
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-1 pr-0.5">
      {identity ?? (
        <img
          src="/brand/logo-wordmark-onlight.svg"
          alt="mosoo"
          className="sidebar-label-enter ml-2 block h-5"
        />
      )}
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
    <div data-sidebar-zone="persistent" className="flex shrink-0 flex-col pt-3">
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
  renderIdentity,
  renderNavigation,
  title,
}: {
  footer?: ReactNode;
  /** Identity row for the drawer header; the wordmark stands in without one. */
  renderIdentity?: (closeNavigation: () => void) => ReactNode;
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
          <div className="flex h-11 shrink-0 items-center">
            {renderIdentity?.(closeNavigation) ?? (
              <img src="/brand/logo-wordmark-onlight.svg" alt="mosoo" className="ml-2 block h-5" />
            )}
          </div>
          <nav
            className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1 [&_[aria-disabled]]:min-h-11 [&_a]:min-h-11 [&_button]:min-h-11"
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
  mobileIdentity,
  mobileSidebar,
  onToggleCollapsed,
  sidebar,
}: {
  children: ReactNode;
  collapsed: boolean;
  footer?: ReactNode;
  /** The identity row in the fixed header line (the Project switcher). */
  identity?: ReactNode;
  /** Identity row for the mobile drawer; receives the drawer's close callback. */
  mobileIdentity?: (closeNavigation: () => void) => ReactNode;
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
        <SidebarHeader
          collapsed={collapsed}
          identity={identity}
          onToggleCollapsed={onToggleCollapsed}
        />
        <div
          data-sidebar-zone="work"
          className="sidebar-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-1 pb-3"
        >
          {sidebar}
        </div>
        <ConsoleSidebarFooter collapsed={collapsed}>{footer}</ConsoleSidebarFooter>
      </nav>

      <div className="flex min-w-0 flex-1">
        <main className="bg-background md:border-border-soft flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-md md:border-l">
          <MobileNavigation
            footer={footer}
            renderNavigation={mobileSidebar}
            {...(mobileIdentity === undefined ? {} : { renderIdentity: mobileIdentity })}
          />
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
        <div className="mt-3">
          <ProjectNavigation collapsed={isCollapsed} pathname={location.pathname} />
        </div>
      </>
    );
  }

  // Mobile drawer: the identity row heads the sheet, the work list follows.
  function projectDrawer(): ReactNode {
    return projectWork(false);
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
        mobileIdentity={(closeNavigation) => projectIdentity(false, closeNavigation)}
        mobileSidebar={() => projectDrawer()}
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
              <h1 className="font-heading text-fg-heading truncate text-[24px] leading-tight font-medium tracking-[-0.01em]">
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
