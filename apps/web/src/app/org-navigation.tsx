import ChartLineData01Icon from "@hugeicons/core-free-icons/ChartLineData01Icon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import Wallet02Icon from "@hugeicons/core-free-icons/Wallet02Icon";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { AppIcon } from "./hugeicon";
import { createHugeicon } from "./hugeicon";

interface OrgNavItem {
  icon: AppIcon;
  label: string;
  path: string | null;
  soon?: boolean;
}

// Org layer = the account/billing shell. Usage and Billing are not built yet, so
// they render as inert "coming soon" entries.
const ORG_NAV_ITEMS: OrgNavItem[] = [
  { icon: createHugeicon(GridViewIcon, "AppsIcon"), label: "Apps", path: "/apps" },
  {
    icon: createHugeicon(ChartLineData01Icon, "UsageIcon"),
    label: "Usage",
    path: null,
    soon: true,
  },
  { icon: createHugeicon(Wallet02Icon, "BillingIcon"), label: "Billing", path: null, soon: true },
  {
    icon: createHugeicon(Settings02Icon, "OrgSettingsIcon"),
    label: "Org settings",
    path: "/org/settings",
  },
];

function isOrgNavItemActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function ComingSoonItem({
  collapsed,
  icon: Icon,
  label,
}: {
  collapsed: boolean;
  icon: AppIcon;
  label: string;
}) {
  const content = (
    <div
      aria-disabled="true"
      className={cn(
        "text-fg-3 flex cursor-default items-center rounded-md text-[13.5px] font-semibold opacity-55",
        collapsed ? "size-9 justify-center self-center" : "gap-2.5 px-2.5 py-2",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? null : (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          <span className="bg-bg-sunken text-fg-3 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide uppercase">
            Soon
          </span>
        </>
      )}
    </div>
  );

  if (!collapsed) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{label} · coming soon</TooltipContent>
    </Tooltip>
  );
}

function OrgNavLink({
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
      <Icon className="size-4 shrink-0" />
      {collapsed ? null : <span className="flex-1 truncate text-left">{label}</span>}
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

export function OrgNavigation({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  return (
    <div className={cn("flex flex-col", collapsed ? "gap-1" : "gap-0.5")}>
      {ORG_NAV_ITEMS.map((item) =>
        item.path === null || item.soon === true ? (
          <ComingSoonItem
            key={item.label}
            collapsed={collapsed}
            icon={item.icon}
            label={item.label}
          />
        ) : (
          <OrgNavLink
            key={item.label}
            collapsed={collapsed}
            icon={item.icon}
            isActive={isOrgNavItemActive(pathname, item.path)}
            label={item.label}
            path={item.path}
          />
        ),
      )}
    </div>
  );
}
