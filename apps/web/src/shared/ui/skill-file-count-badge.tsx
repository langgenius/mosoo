import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";

type Translate = (key: string, variables?: Record<string, string>) => string;
const defaultTranslate: Translate = (key) => key;

export function formatSkillFileCount(count: number, t: Translate = defaultTranslate): string {
  if (count === 1) {
    return t("skills.fileCountOne");
  }

  return t("skills.fileCount", { count: String(count) });
}

export function SkillFileCountBadge({
  className,
  count,
}: {
  className?: string;
  count: number;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "border-border-subtle text-muted-foreground inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
        className,
      )}
    >
      {formatSkillFileCount(count, t)}
    </span>
  );
}
