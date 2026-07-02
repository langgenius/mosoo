import BotIcon from "@hugeicons/core-free-icons/BotIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import DashboardSquare01Icon from "@hugeicons/core-free-icons/DashboardSquare01Icon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import type { MouseEvent } from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { AppIcon } from "./hugeicon";
import { createHugeicon } from "./hugeicon";

interface AppNavChild {
  label: string;
  path: string;
}

interface AppNavItem {
  children?: AppNavChild[];
  icon: AppIcon;
  label: string;
  path: string;
}

interface AppNavSection {
  label?: string;
  items: AppNavItem[];
}

const NAV_SECTIONS: AppNavSection[] = [
  {
    items: [
      { icon: createHugeicon(DashboardSquare01Icon, "OverviewIcon"), label: "Overview", path: "/" },
      { icon: createHugeicon(InboxIcon, "ThreadsIcon"), label: "Threads", path: "/threads" },
      { icon: createHugeicon(BotIcon, "AgentsIcon"), label: "Agents", path: "/agent" },
      {
        children: [
          { label: "Skills", path: "/integrations/skills" },
          { label: "MCP servers", path: "/integrations/mcp" },
          { label: "Providers", path: "/providers" },
          { label: "Environments", path: "/environment" },
        ],
        icon: createHugeicon(SlidersHorizontalIcon, "ConfigIcon"),
        label: "Config",
        path: "/integrations",
      },
    ],
    label: "App",
  },
  {
    items: [
      {
        icon: createHugeicon(Settings02Icon, "AppSettingsIcon"),
        label: "Settings",
        path: "/app-settings",
      },
    ],
    label: "Account",
  },
];

const ExpandIcon = createHugeicon(ChevronRightIcon, "ExpandIcon");

function isNavItemActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavLink({
  collapsed,
  icon: Icon,
  isActive,
  label,
  path,
}: {
  collapsed: boolean;
  icon: AppIcon;
  isActive: boolean;
  label: string;
  path: string;
}) {
  const link = (
    <Link
      to={path}
      aria-label={label}
      className={cn(
        "flex items-center rounded-md text-[13.5px] font-semibold transition-colors",
        collapsed ? "size-9 justify-center self-center" : "gap-2.5 px-2.5 py-2",
        isActive ? "bg-ink-100 text-fg-1" : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
      )}
    >
      <Icon className="size-4" />
      {collapsed ? null : <span>{label}</span>}
    </Link>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavGroup({
  collapsed,
  item,
  pathname,
}: {
  collapsed: boolean;
  item: AppNavItem;
  pathname: string;
}) {
  const navigate = useNavigate();
  const Icon = item.icon;
  const onPath =
    isNavItemActive(pathname, item.path) ||
    (item.children ?? []).some((child) => isNavItemActive(pathname, child.path));
  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);
  const expanded = manuallyExpanded ?? onPath;
  const parentSelfActive = pathname === item.path;

  function toggleExpansion(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setManuallyExpanded(!expanded);
  }

  function handleCollapsedTrigger() {
    void navigate(item.path);
  }

  if (collapsed) {
    const trigger = (
      <button
        type="button"
        aria-label={item.label}
        aria-expanded={expanded}
        onClick={handleCollapsedTrigger}
        className={cn(
          "flex size-9 items-center justify-center self-center rounded-md text-[13.5px] font-semibold transition-colors",
          parentSelfActive
            ? "bg-ink-100 text-fg-1"
            : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
        )}
      >
        <Icon className="size-4 shrink-0" />
      </button>
    );

    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "group/row flex items-stretch rounded-md transition-colors",
          parentSelfActive
            ? "bg-ink-100 text-fg-1"
            : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
        )}
      >
        <Link
          to={item.path}
          aria-label={item.label}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-semibold"
        >
          <Icon className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">{item.label}</span>
        </Link>
        {item.children && item.children.length > 0 ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
            aria-expanded={expanded}
            onClick={toggleExpansion}
            className="text-fg-3 hover:text-fg-1 flex w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <ExpandIcon
              className={cn(
                "size-3.5 transition-transform duration-150 ease-out",
                expanded ? "rotate-90" : "rotate-0",
              )}
            />
          </button>
        ) : null}
      </div>

      {item.children && item.children.length > 0 ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="mt-0.5 flex flex-col gap-0.5 pl-[34px]">
              {item.children.map((child) => {
                const childActive = isNavItemActive(pathname, child.path);
                return (
                  <Link
                    key={child.path}
                    to={child.path}
                    className={cn(
                      "relative flex items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                      childActive
                        ? "bg-ink-100 text-fg-1"
                        : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mr-2 inline-block size-1 rounded-full transition-colors",
                        childActive ? "bg-fg-1" : "bg-fg-3/40",
                      )}
                    />
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NavSection({
  collapsed,
  pathname,
  section,
}: {
  collapsed: boolean;
  pathname: string;
  section: AppNavSection;
}) {
  return (
    <div className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5")}>
      {!collapsed && section.label ? (
        <div className="text-fg-3 mt-3 mb-1 px-2.5 text-[10.5px] font-semibold tracking-wider uppercase">
          {section.label}
        </div>
      ) : null}
      {section.items.map((item) =>
        item.children && item.children.length > 0 ? (
          <NavGroup key={item.path} collapsed={collapsed} item={item} pathname={pathname} />
        ) : (
          <NavLink
            key={item.path}
            collapsed={collapsed}
            icon={item.icon}
            isActive={isNavItemActive(pathname, item.path)}
            label={item.label}
            path={item.path}
          />
        ),
      )}
    </div>
  );
}

export function AppNavigation({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  return (
    <div className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0")}>
      {NAV_SECTIONS.map((section, index) => (
        <div key={section.label ?? `section-${index}`} className="flex flex-col">
          {collapsed && index > 0 ? (
            <div aria-hidden="true" className="bg-border-soft mx-auto my-1.5 h-px w-6" />
          ) : null}
          <NavSection collapsed={collapsed} pathname={pathname} section={section} />
        </div>
      ))}
    </div>
  );
}
