import { NavLink, Outlet } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { User } from "@/shared/ui/icons";

// Settings keeps account-global controls. Project-scoped settings live in the
// primary Project sidebar.
export function SettingsLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      <aside className="border-border-soft flex w-full shrink-0 flex-col gap-3 overflow-x-auto border-b px-4 py-2 md:w-[220px] md:overflow-visible md:border-r md:border-b-0 md:px-3 md:py-5">
        <div className="t-group-label hidden px-2.5 pb-1 md:block">{t("pageTitle.settings")}</div>
        <div className="flex flex-col gap-1">
          <div className="t-group-label hidden px-2.5 pb-1 md:block">{t("settings.account")}</div>
          <div className="flex gap-1 md:flex-col md:gap-0.5">
            <NavLink
              to="/settings/profile"
              className={({ isActive }) =>
                cn(
                  "focus-visible:ring-ring focus-visible:ring-offset-background flex min-h-11 shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium whitespace-nowrap outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1 md:min-h-0",
                  isActive ? "bg-selected text-fg-1" : "text-fg-2 hover:bg-hover hover:text-fg-1",
                )
              }
            >
              <User className="size-4" />
              <span>{t("settings.profile")}</span>
            </NavLink>
          </div>
        </div>
      </aside>
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
