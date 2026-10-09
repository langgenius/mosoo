import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { AlertTriangle } from "@/shared/ui/icons";

import {
  SESSION_EVENT_DOMAIN_TONE,
  SESSION_EVENT_FILTER_DOMAINS,
  getSessionEventDomainLabel,
} from "./domain";
import type { SessionEventDomain } from "./domain";

export function DomainFilterBar({
  domains,
  errorsOnly,
  onReset,
  onToggleDomain,
  onToggleErrorsOnly,
  visibleCount,
  totalCount,
}: {
  domains: ReadonlySet<SessionEventDomain>;
  errorsOnly: boolean;
  onReset: () => void;
  onToggleDomain: (domain: SessionEventDomain) => void;
  onToggleErrorsOnly: () => void;
  totalCount: number;
  visibleCount: number;
}): ReactElement {
  const { t } = useTranslation();
  const filtered = visibleCount !== totalCount;

  return (
    <div className="border-border-soft bg-card/95 sticky top-0 z-10 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-1.5">
        {SESSION_EVENT_FILTER_DOMAINS.map((domain) => {
          const active = domains.has(domain);
          const tone = SESSION_EVENT_DOMAIN_TONE[domain];

          return (
            <button
              key={domain}
              type="button"
              onClick={() => {
                onToggleDomain(domain);
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-semibold transition-colors",
                active ? tone.chip : "border-border bg-card text-fg-3 hover:bg-sunken/50",
              )}
            >
              <span className={cn("size-2 rounded-sm", tone.swatch)} />
              {getSessionEventDomainLabel(domain, t)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleErrorsOnly}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-semibold transition-colors",
            errorsOnly
              ? "border-warning/30 bg-warning-bg text-warning-fg"
              : "border-border bg-card text-fg-3 hover:bg-sunken/50",
          )}
        >
          {errorsOnly ? <AlertTriangle className="size-3" /> : null}
          {errorsOnly ? t("sessionEvents.errorsOnly") : t("threads.all")}
        </button>
      </div>
      <div className="text-fg-3 flex items-center gap-2 text-[11px]">
        <span>
          {t("sessionEvents.showingEvents", {
            totalCount: String(totalCount),
            visibleCount: String(visibleCount),
          })}
        </span>
        {filtered ? (
          <button
            type="button"
            onClick={onReset}
            className="text-link hover:text-link-hover font-semibold underline"
          >
            {t("sessionEvents.resetFilter")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
