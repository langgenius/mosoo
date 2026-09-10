import { NavLink } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { BarChart3, Box, KeyRound } from "@/shared/ui/icons";
import type { AppIcon } from "@/shared/ui/icons";

interface ProjectSettingsNavItem {
  icon: AppIcon;
  labelKey: string;
  path: string;
}

const PROJECT_SETTINGS_NAV_ITEMS: ProjectSettingsNavItem[] = [
  { icon: KeyRound, labelKey: "settings.accessTokens", path: "/project-settings/api-keys" },
  { icon: Box, labelKey: "settings.general", path: "/project-settings/general" },
  { icon: BarChart3, labelKey: "projectSettings.usage", path: "/project-settings/usage" },
];

export function ProjectSettingsNav() {
  const { t } = useTranslation();

  return (
    <aside className="border-border-soft flex w-full shrink-0 flex-col gap-3 overflow-x-auto border-b px-4 py-2 md:w-[220px] md:overflow-visible md:border-r md:border-b-0 md:px-3 md:py-5">
      <div className="t-group-label hidden px-2.5 pb-1 md:block">{t("nav.project")}</div>
      <div className="flex gap-1 md:flex-col md:gap-0.5">
        {PROJECT_SETTINGS_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "focus-visible:ring-ring focus-visible:ring-offset-background flex min-h-11 shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium whitespace-nowrap outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1 md:min-h-0",
                isActive ? "bg-selected text-fg-1" : "text-fg-2 hover:bg-hover hover:text-fg-1",
              )
            }
          >
            <item.icon className="size-4" />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
