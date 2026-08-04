import { LanguageCircleIcon } from "@hugeicons/core-free-icons";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from "./locales";
import { useTranslation } from "./provider";

interface LocaleSwitcherProps {
  className?: string;
  collapsed?: boolean;
}

export function LocaleSwitcher({ className, collapsed = false }: LocaleSwitcherProps) {
  const { i18n, t } = useTranslation();
  const current = i18n.language;
  const currentLabel = LOCALE_DISPLAY_NAMES[current] ?? current;

  const trigger = (
    <DropdownMenuTrigger
      aria-label={`${t("settings.language")}: ${currentLabel}`}
      className={cn(
        "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1 flex items-center rounded-md text-[13.5px] font-semibold transition-colors",
        collapsed ? "size-9 justify-center self-center" : "w-full gap-2.5 px-2.5 py-2",
        className,
      )}
    >
      <HugeiconsIcon icon={LanguageCircleIcon} className="size-4 shrink-0" />
      {collapsed ? null : (
        <span className="sidebar-label-enter min-w-0 flex-1 truncate text-left">
          {currentLabel}
        </span>
      )}
    </DropdownMenuTrigger>
  );

  const content = (
    <DropdownMenuContent
      align="start"
      side={collapsed ? "right" : "top"}
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
            <HugeiconsIcon icon={CheckIcon} className="text-fg-2 ml-auto size-4" />
          ) : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );

  if (!collapsed) {
    return (
      <DropdownMenu>
        {trigger}
        {content}
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="right">{currentLabel}</TooltipContent>
      </Tooltip>
      {content}
    </DropdownMenu>
  );
}
