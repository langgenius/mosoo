import ChartLineData01Icon from "@hugeicons/core-free-icons/ChartLineData01Icon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import Wallet02Icon from "@hugeicons/core-free-icons/Wallet02Icon";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { SidebarRow } from "@/shared/ui/sidebar";
import type { SidebarIcon } from "@/shared/ui/sidebar";

import { createHugeicon } from "./hugeicon";

interface OrgNavItem {
  icon: SidebarIcon;
  labelKey: string;
  path: string | null;
}

// Org layer = the account/billing shell. Usage and Billing are not built yet, so
// they render as inert "coming soon" rows that stay legible but never navigate.
const ORG_NAV_ITEMS: OrgNavItem[] = [
  {
    icon: createHugeicon(GridViewIcon, "ProjectsIcon"),
    labelKey: "pageTitle.projects",
    path: "/projects",
  },
  {
    icon: createHugeicon(ChartLineData01Icon, "UsageIcon"),
    labelKey: "pageTitle.usage",
    path: null,
  },
  {
    icon: createHugeicon(Wallet02Icon, "BillingIcon"),
    labelKey: "org.billing",
    path: null,
  },
  {
    icon: createHugeicon(Settings02Icon, "OrgSettingsIcon"),
    labelKey: "pageTitle.orgSettings",
    path: "/org/settings",
  },
];

function isOrgNavItemActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function ComingSoonBadge(): ReactElement {
  const { t } = useTranslation();

  return (
    <span className="bg-muted text-fg-3 rounded-sm px-1 text-[10px] leading-4 font-semibold tracking-[0.04em] uppercase">
      {t("agent.soon")}
    </span>
  );
}

export function OrgNavigation({
  collapsed,
  pathname,
}: {
  collapsed: boolean;
  pathname: string;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-0.5">
      {ORG_NAV_ITEMS.map((item) => {
        const label = t(item.labelKey);

        if (item.path === null) {
          return (
            <SidebarRow
              key={item.labelKey}
              collapsed={collapsed}
              disabled
              end={<ComingSoonBadge />}
              icon={item.icon}
              label={label}
              tooltip={t("org.comingSoon", { label })}
            />
          );
        }

        return (
          <SidebarRow
            key={item.labelKey}
            active={isOrgNavItemActive(pathname, item.path)}
            collapsed={collapsed}
            icon={item.icon}
            label={label}
            to={item.path}
          />
        );
      })}
    </div>
  );
}
