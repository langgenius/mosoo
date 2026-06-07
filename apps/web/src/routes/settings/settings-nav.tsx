import { Permission, can } from "@mosoo/contracts/permission";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Bot, Box, Building2, KeyRound, User, Users, Wallet } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";

import { useAppSession } from "../../app/session-provider";

interface SettingsNavItem {
  adminOnly?: boolean;
  icon: LucideIcon;
  label: string;
  ownerOnly?: boolean;
  path: string;
}

interface SettingsNavSection {
  items: SettingsNavItem[];
  label: string;
}

const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
  {
    items: [
      { icon: User, label: "Profile", path: "/settings/profile" },
      { icon: KeyRound, label: "API tokens", path: "/settings/access-tokens" },
      { icon: Bot, label: "Agent builder", path: "/settings/system-agent" },
      { icon: BarChart3, label: "My usage", path: "/settings/usage" },
    ],
    label: "Account",
  },
  {
    items: [
      {
        icon: Building2,
        label: "General",
        ownerOnly: true,
        path: "/settings/general",
      },
      { icon: Users, label: "Members", path: "/settings/members" },
      {
        adminOnly: true,
        icon: Box,
        label: "Environments",
        path: "/settings/environments",
      },
      {
        adminOnly: true,
        icon: Wallet,
        label: "Cost",
        path: "/settings/cost",
      },
    ],
    label: "Organization",
  },
];

export function SettingsNav() {
  const { activeOrganization } = useAppSession();
  const isAdmin = can(activeOrganization?.viewerRole, Permission.ProvidersCompanyManage);
  const isOwner = activeOrganization?.viewerRole === "owner";

  return (
    <aside className="border-border-soft flex w-[220px] shrink-0 flex-col gap-3 border-r px-3 py-5">
      <div className="text-fg-3 px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
        Settings
      </div>
      {SETTINGS_NAV_SECTIONS.map((section) => {
        const visibleItems = section.items.filter((item) => {
          if (item.ownerOnly && !isOwner) {
            return false;
          }

          if (item.adminOnly && !isAdmin) {
            return false;
          }

          return true;
        });

        if (visibleItems.length === 0) {
          return null;
        }

        return (
          <div key={section.label} className="flex flex-col gap-1">
            <div className="text-fg-3 px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                      isActive
                        ? "bg-ink-100 text-fg-1"
                        : "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1",
                    )
                  }
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
