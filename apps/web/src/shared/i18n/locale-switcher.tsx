import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import LanguageCircleIcon from "@hugeicons/core-free-icons/LanguageCircleIcon";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { createHugeicon } from "@/shared/ui/icons";
import { SidebarRowBody, SidebarTooltip, sidebarRowClassName } from "@/shared/ui/sidebar";

import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from "./locales";
import { useTranslation } from "./provider";

const LanguageIcon = createHugeicon(LanguageCircleIcon, "LanguageIcon");
const SelectedLocaleIcon = createHugeicon(CheckIcon, "SelectedLocaleIcon");

interface LocaleSwitcherProps {
  className?: string;
  /** Icon-only sidebar rail; ignored in compact mode. */
  collapsed?: boolean;
  /** Inline trigger for the auth top bar instead of a sidebar row. */
  compact?: boolean;
}

export function LocaleSwitcher({
  className,
  collapsed = false,
  compact = false,
}: LocaleSwitcherProps): ReactElement {
  const { i18n, t } = useTranslation();
  const current = i18n.language;
  const currentLabel = LOCALE_DISPLAY_NAMES[current] ?? current;
  const accessibleName = `${t("settings.language")}: ${currentLabel}`;
  const rail = collapsed && !compact;

  const trigger = compact ? (
    <DropdownMenuTrigger
      aria-label={accessibleName}
      className={cn(
        "text-fg-2 hover:bg-sidebar-row-hover hover:text-fg-1 flex w-auto items-center gap-2 rounded-md px-2.5 py-2 text-[13.5px] font-semibold transition-colors",
        className,
      )}
    >
      <LanguageIcon className="size-4 shrink-0" />
      <span className="max-w-32 min-w-0 truncate text-left">{currentLabel}</span>
    </DropdownMenuTrigger>
  ) : (
    <DropdownMenuTrigger
      aria-label={accessibleName}
      className={sidebarRowClassName({ className, collapsed })}
    >
      <SidebarRowBody collapsed={collapsed} icon={LanguageIcon} label={currentLabel} />
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      <SidebarTooltip collapsed={rail} label={currentLabel}>
        {trigger}
      </SidebarTooltip>
      <DropdownMenuContent
        align={compact ? "end" : "start"}
        side={rail ? "right" : compact ? "bottom" : "top"}
        sideOffset={compact ? 4 : 6}
        className="w-[220px] rounded-lg p-1"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            className={cn("cursor-pointer rounded-md", locale === current && "font-medium")}
            onClick={() => {
              i18n.changeLanguage(locale);
            }}
          >
            {LOCALE_DISPLAY_NAMES[locale]}
            {locale === current ? (
              <SelectedLocaleIcon className="text-fg-2 ml-auto size-4" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
