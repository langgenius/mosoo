import type { LucideIcon } from "lucide-react";
import { BarChart3, KeyRound, User } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";

interface SettingsNavItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

interface SettingsNavSection {
  items: SettingsNavItem[];
  label: string;
}

// Settings keeps account-global controls and account-adjacent reporting. App
// settings live in the primary App sidebar as a standalone page.
const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
  {
    items: [
      { icon: User, label: "Profile", path: "/settings/profile" },
      { icon: KeyRound, label: "API tokens", path: "/settings/access-tokens" },
    ],
    label: "Account",
  },
  {
    items: [{ icon: BarChart3, label: "App usage", path: "/settings/usage" }],
    label: "App",
  },
];

export function SettingsNav() {
  return (
    <aside className="border-border-soft flex w-[220px] shrink-0 flex-col gap-3 border-r px-3 py-5">
      <div className="text-fg-3 px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
        Settings
      </div>
      {SETTINGS_NAV_SECTIONS.map((section) => {
        return (
          <div key={section.label} className="flex flex-col gap-1">
            <div className="text-fg-3 px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
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
