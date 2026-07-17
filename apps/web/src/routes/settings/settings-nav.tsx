import type { LucideIcon } from "lucide-react";
import { KeyRound, User } from "lucide-react";
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

// Settings keeps account-global controls. App-scoped settings live in the
// primary App sidebar.
const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
  {
    items: [
      { icon: User, label: "Profile", path: "/settings/profile" },
      { icon: KeyRound, label: "API tokens", path: "/settings/access-tokens" },
    ],
    label: "Account",
  },
];

export function SettingsNav() {
  return (
    <aside className="border-border-soft flex w-full shrink-0 flex-col gap-3 overflow-x-auto border-b px-4 py-2 md:w-[220px] md:overflow-visible md:border-r md:border-b-0 md:px-3 md:py-5">
      <div className="text-fg-3 hidden px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase md:block">
        Settings
      </div>
      {SETTINGS_NAV_SECTIONS.map((section) => {
        return (
          <div key={section.label} className="flex flex-col gap-1">
            <div className="text-fg-3 hidden px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase md:block">
              {section.label}
            </div>
            <div className="flex gap-1 md:flex-col md:gap-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors md:min-h-0",
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
