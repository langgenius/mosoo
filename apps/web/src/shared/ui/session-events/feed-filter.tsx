import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import {
  SESSION_EVENT_DOMAIN_LABEL,
  SESSION_EVENT_DOMAIN_TONE,
  SESSION_EVENT_FILTER_DOMAINS,
} from "./domain";
import type { SessionEventDomain } from "./domain";

export function EmptyFeedState(): ReactElement {
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-16">
      <div className="max-w-sm text-center">
        <div className="text-fg-1 text-[14px] font-semibold">No events yet.</div>
        <p className="text-fg-3 mt-1 text-[12.5px] leading-5">
          The first user.message will appear here when the agent runs.
        </p>
      </div>
    </div>
  );
}

export function FilterEmptyState({ onReset }: { onReset: () => void }): ReactElement {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-8 text-center">
      <div>
        <div className="text-fg-1 text-[14px] font-semibold">No events match these filters.</div>
        <p className="text-fg-3 mt-1 text-[12.5px]">Reset the feed to inspect the full turn.</p>
      </div>
      <Button onClick={onReset} size="sm" variant="outline">
        Reset filters
      </Button>
    </div>
  );
}

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
  const filtered = visibleCount !== totalCount;

  return (
    <div className="border-border-subtle sticky top-0 z-10 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-white/95 px-4 py-2 backdrop-blur">
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
                active ? tone.chip : "border-border bg-card text-fg-3 hover:bg-muted/50",
              )}
            >
              <span className={cn("size-2 rounded-sm", tone.swatch)} />
              {SESSION_EVENT_DOMAIN_LABEL[domain]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleErrorsOnly}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-semibold transition-colors",
            errorsOnly
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-border bg-card text-fg-3 hover:bg-muted/50",
          )}
        >
          {errorsOnly ? <AlertTriangle className="size-3" /> : null}
          {errorsOnly ? "Errors only" : "All"}
        </button>
      </div>
      <div className="text-fg-3 flex items-center gap-2 text-[11px]">
        <span>
          Showing {visibleCount} of {totalCount} events
        </span>
        {filtered ? (
          <button
            type="button"
            onClick={onReset}
            className="text-accent-press font-semibold hover:underline"
          >
            Reset filter
          </button>
        ) : null}
      </div>
    </div>
  );
}
