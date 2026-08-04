import { HugeiconsIcon } from "@hugeicons/react";
import { LanguageCircleIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "./provider";

import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from "./locales";

interface LocaleSwitcherProps {
  className?: string;
}

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { i18n } = useTranslation();
  const current = i18n.language;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
          className,
        )}
      >
        <HugeiconsIcon icon={LanguageCircleIcon} className="size-4" />
        <span>{LOCALE_DISPLAY_NAMES[current] ?? current}</span>
      </DropdownMenuTrigger>
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
    </DropdownMenu>
  );
}