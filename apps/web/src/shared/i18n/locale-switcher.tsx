import { LanguageCircleIcon } from "@hugeicons/core-free-icons";
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
  const { i18n } = useTranslation();
  const current = i18n.language;

  const trigger = (
    <DropdownMenuTrigger
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        collapsed && "justify-center px-0",
        className,
      )}
    >
      <HugeiconsIcon icon={LanguageCircleIcon} className="size-4" />
      {collapsed ? null : <span>{LOCALE_DISPLAY_NAMES[current] ?? current}</span>}
    </DropdownMenuTrigger>
  );

  const content = (
    <DropdownMenuContent align="end" side="top">
      {SUPPORTED_LOCALES.map((locale) => (
        <DropdownMenuItem
          key={locale}
          className={cn(locale === current && "font-medium")}
          onClick={() => {
            i18n.changeLanguage(locale);
          }}
        >
          {LOCALE_DISPLAY_NAMES[locale]}
          {locale === current && <span className="ml-auto text-xs">✓</span>}
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
        <TooltipContent side="right">{LOCALE_DISPLAY_NAMES[current] ?? current}</TooltipContent>
      </Tooltip>
      {content}
    </DropdownMenu>
  );
}
