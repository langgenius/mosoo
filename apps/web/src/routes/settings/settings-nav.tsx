import { NavLink } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import type { AppIcon } from "@/shared/ui/icons";
import { User } from "@/shared/ui/icons";

interface SettingsNavItem {
  icon: AppIcon;
  labelKey: string;
  path: string;
}

interface SettingsNavSection {
  items: SettingsNavItem[];
  labelKey: string;
}

// Settings keeps account-global controls. Project-scoped settings live in the
// primary Project sidebar.
const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
  {
    items: [{ icon: User, labelKey: "settings.profile", path: "/settings/profile" }],
    labelKey: "settings.account",
  },
];

export function SettingsNav() {
  const { t } = useTranslation();

  return (
    <aside className="border-border-soft flex w-full shrink-0 flex-col gap-3 overflow-x-auto border-b px-4 py-2 md:w-[220px] md:overflow-visible md:border-r md:border-b-0 md:px-3 md:py-5">
      <div className="t-group-label hidden px-2.5 pb-1 md:block">{t("pageTitle.settings")}</div>
      {SETTINGS_NAV_SECTIONS.map((section) => {
        return (
          <div key={section.labelKey} className="flex flex-col gap-1">
            <div className="t-group-label hidden px-2.5 pb-1 md:block">{t(section.labelKey)}</div>
            <div className="flex gap-1 md:flex-col md:gap-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      "focus-visible:ring-ring focus-visible:ring-offset-background flex min-h-11 shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium whitespace-nowrap outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1 md:min-h-0",
                      isActive
                        ? "bg-selected text-fg-1"
                        : "text-fg-2 hover:bg-hover hover:text-fg-1",
                    )
                  }
                >
                  <item.icon className="size-4" />
                  <span>{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
