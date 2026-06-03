import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Box,
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  KeyRound,
  Puzzle,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

interface AppNavChild {
  label: string;
  path: string;
}

interface AppNavItem {
  children?: AppNavChild[];
  icon: LucideIcon;
  label: string;
  path: string;
}

interface AppNavSection {
  items: AppNavItem[];
  label: string;
  requiresGovernanceAccess?: boolean;
}

const NAV_SECTIONS: AppNavSection[] = [
  {
    items: [{ icon: Inbox, label: "Threads", path: "/threads" }],
    label: "Work",
  },
  {
    items: [
      { icon: Bot, label: "Agents", path: "/agent" },
      { icon: Folder, label: "Spaces", path: "/space" },
      { icon: Box, label: "Environments", path: "/environment" },
      {
        children: [
          { label: "Skills", path: "/integrations/skills" },
          { label: "MCP Servers", path: "/integrations/mcp" },
        ],
        icon: Puzzle,
        label: "Integrations",
        path: "/integrations",
      },
      { icon: KeyRound, label: "Providers", path: "/providers" },
    ],
    label: "Studio",
  },
  {
    items: [{ icon: BarChart3, label: "Cost", path: "/cost" }],
    label: "Governance",
    requiresGovernanceAccess: true,
  },
];

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
  icon: LucideIcon;
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
        isActive
          ? "bg-ink-100 text-fg-1"
          : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
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
  const onPath = isNavItemActive(pathname, item.path);
  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);
  const expanded = manuallyExpanded ?? onPath;

  function toggleNavigationSection() {
    if (collapsed) {
      void navigate(item.path);
      return;
    }

    if (!onPath) {
      void navigate(item.path);
      setManuallyExpanded(true);
      return;
    }

    setManuallyExpanded(!expanded);
  }

  const parentSelfActive = pathname === item.path;

  const trigger = (
    <button
      type="button"
      aria-label={item.label}
      aria-expanded={expanded}
      onClick={toggleNavigationSection}
      className={cn(
        "flex items-center rounded-md text-[13.5px] font-semibold transition-colors w-full",
        collapsed ? "size-9 justify-center self-center" : "gap-2.5 px-2.5 py-2",
        parentSelfActive
          ? "bg-ink-100 text-fg-1"
          : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? null : (
        <>
          <span className="flex-1 text-left">{item.label}</span>
          {expanded ? (
            <ChevronDown className="text-fg-3 size-3.5" />
          ) : (
            <ChevronRight className="text-fg-3 size-3.5" />
          )}
        </>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col">
      {trigger}
      {expanded && item.children ? (
        <div className="relative mt-0.5 pl-[18px]">
          <span
            aria-hidden="true"
            className="bg-border-soft pointer-events-none absolute top-1 bottom-1 left-[18px] w-px"
          />
          <div className="flex flex-col gap-0.5 pl-3">
            {item.children.map((child) => {
              const childActive = isNavItemActive(pathname, child.path);
              return (
                <Link
                  key={child.path}
                  to={child.path}
                  className={cn(
                    "flex items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    childActive
                      ? "bg-ink-100 text-fg-1"
                      : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
                  )}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppNavigation({
  canReadGovernance,
  collapsed,
  pathname,
}: {
  canReadGovernance: boolean;
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <div className={cn("flex flex-col", collapsed ? "gap-2" : "gap-3")}>
      {NAV_SECTIONS.map((section, sectionIndex) => {
        if (section.requiresGovernanceAccess === true && !canReadGovernance) {
          return null;
        }

        return (
          <div key={section.label}>
            {collapsed ? (
              sectionIndex > 0 ? (
                <div className="bg-border-soft mx-auto mb-2 h-px w-6" />
              ) : null
            ) : (
              <div className="text-fg-3 px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
                {section.label}
              </div>
            )}
            <div className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5")}>
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
          </div>
        );
      })}
    </div>
  );
}
