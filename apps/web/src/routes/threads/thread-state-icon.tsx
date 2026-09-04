import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { CheckCircle2, CircleDashed, CircleX } from "@/shared/ui/icons";

import type { ThreadStateGlyph } from "./model/thread";

export function ThreadStateIcon({ glyph }: { glyph: ThreadStateGlyph }): ReactElement {
  const { t } = useTranslation();

  switch (glyph) {
    case "archived": {
      return (
        <CircleDashed className="text-fg-3 size-3.5 shrink-0" aria-label={t("threads.archived")} />
      );
    }
    case "failed": {
      return (
        <CircleX className="text-destructive size-3.5 shrink-0" aria-label={t("threads.failed")} />
      );
    }
    case "success": {
      return (
        <CheckCircle2
          className="text-primary size-3.5 shrink-0"
          aria-label={t("threads.completed")}
        />
      );
    }
    case "working": {
      return (
        <svg
          aria-label={t("threads.working")}
          className="relative inline-block size-3.5 shrink-0"
          viewBox="0 0 14 14"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="7" cy="7" r="4" className="fill-primary opacity-70">
            <animate attributeName="r" values="3;5;3" dur="1s" repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              values="0.7;0.2;0.7"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="7" cy="7" r="4" className="fill-primary" />
        </svg>
      );
    }
  }
}
