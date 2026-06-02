import { RefreshCw, TriangleAlert } from "lucide-react";

import type { AuditEvent } from "@/domains/audit/api/audit-client";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { formatRelativeTime, getCategory } from "./audit-log-model";

export function AuditEventList({
  events,
  hasNonDefaultFilters,
  isLoading,
  isRefreshing,
  loadError,
  onClear,
  onSelect,
  onRetry,
  selectedId,
}: {
  events: AuditEvent[];
  hasNonDefaultFilters: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  loadError: unknown | null;
  onClear: () => void;
  onSelect: (eventId: string) => void;
  onRetry: () => void;
  selectedId: string | null;
}) {
  if (isLoading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center px-8 text-center text-sm">
        Loading audit events…
      </div>
    );
  }

  if (loadError) {
    return <AuditEventsError error={loadError} isRefreshing={isRefreshing} onRetry={onRetry} />;
  }

  if (events.length === 0) {
    return <EmptyEvents hasNonDefaultFilters={hasNonDefaultFilters} onClear={onClear} />;
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-border-subtle flex min-h-10 items-center justify-between gap-3 border-b px-5 py-2 md:px-8">
        <div className="text-foreground text-sm font-semibold">Events</div>
        <div className="text-muted-foreground text-right text-[12px]">
          Events may take up to 1 minute to appear
        </div>
      </div>

      <div className="hidden min-w-[920px] flex-1 md:block">
        <div className="border-border-subtle text-muted-foreground grid h-9 grid-cols-[140px_180px_160px_minmax(180px,1fr)_100px_140px] items-center gap-3 border-b px-5 text-[11px] font-semibold tracking-[0.1em] uppercase md:px-8">
          <div>Time</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Resource</div>
          <div>Outcome</div>
          <div>IP</div>
        </div>
        <div className="divide-border-subtle divide-y">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => {
                onSelect(event.id);
              }}
              className={cn(
                "grid min-h-11 w-full grid-cols-[140px_180px_160px_minmax(180px,1fr)_100px_140px] items-center gap-3 px-5 py-1.5 text-left hover:bg-muted/40 md:px-8",
                selectedId === event.id ? "bg-accent-soft/70" : "",
              )}
            >
              <TimeCell timestamp={event.timestamp} />
              <div className="text-foreground min-w-0 truncate text-sm">{event.actor.display}</div>
              <div className="text-foreground min-w-0 truncate font-mono text-[12px] font-semibold">
                {event.action}
              </div>
              <div className="min-w-0">
                <div className="text-foreground truncate text-sm font-medium">
                  {event.resourceDisplay ?? event.resourceId ?? "Unknown resource"}
                </div>
                <div className="text-muted-foreground truncate font-mono text-[11px]">
                  {event.resourceId ?? event.resourceType}
                </div>
              </div>
              <OutcomeCell outcome={event.outcome} />
              <div className="text-muted-foreground min-w-0 truncate font-mono text-[12px]">
                {event.ipAddress ?? "unknown"}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="divide-border-subtle divide-y md:hidden">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => {
              onSelect(event.id);
            }}
            className={cn(
              "w-full px-5 py-3 text-left hover:bg-muted/40",
              selectedId === event.id ? "bg-accent-soft/70" : "",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <OutcomeDot outcome={event.outcome} />
                  <span className="text-foreground truncate font-mono text-[12px] font-semibold">
                    {event.action}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {getCategory(event.action)}
                  </span>
                </div>
                <div className="text-foreground mt-1 truncate text-sm font-medium">
                  {event.resourceDisplay ?? event.resourceId ?? "Unknown resource"}
                </div>
              </div>
              <OutcomeCell outcome={event.outcome} />
            </div>
            <div className="text-muted-foreground mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[12px]">
              <span className="truncate">{event.actor.display}</span>
              <span className="font-mono">{event.ipAddress ?? "unknown"}</span>
              <span suppressHydrationWarning>{formatRelativeTime(event.timestamp)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="border-border-subtle text-muted-foreground mt-auto border-t px-5 py-2 text-[12px] md:px-8">
        Showing {events.length} events.
      </div>
    </div>
  );
}

function EmptyEvents({
  hasNonDefaultFilters,
  onClear,
}: {
  hasNonDefaultFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div>
        <div className="text-muted-foreground text-sm">
          {hasNonDefaultFilters
            ? "No events match these filters. Widen the date range or clear filters."
            : "No events recorded yet. Audit Log captures admin actions, member changes, and credential events as they happen."}
        </div>
        {hasNonDefaultFilters ? (
          <Button className="mt-3" onClick={onClear} size="sm" variant="outline">
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TimeCell({ timestamp }: { timestamp: string }) {
  return (
    <div className="text-muted-foreground text-[12px]">
      <div className="text-foreground font-medium" suppressHydrationWarning>
        {formatRelativeTime(timestamp)}
      </div>
      <div suppressHydrationWarning>
        {new Date(timestamp).toLocaleString(undefined, {
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
        })}
      </div>
    </div>
  );
}

function OutcomeDot({ outcome }: { outcome: AuditEvent["outcome"] }) {
  if (outcome === "success") {
    return null;
  }

  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        outcome === "denied" ? "bg-destructive" : "bg-amber",
      )}
    />
  );
}

function OutcomeCell({ outcome }: { outcome: AuditEvent["outcome"] }) {
  if (outcome === "success") {
    return <span className="text-muted-foreground text-[12px]">success</span>;
  }

  return (
    <span className="flex items-center gap-2">
      <OutcomeDot outcome={outcome} />
      <Badge
        className={cn(
          "capitalize",
          outcome === "denied" ? "border-destructive text-destructive" : "border-amber text-soil",
        )}
        variant="outline"
      >
        {outcome}
      </Badge>
    </span>
  );
}

function AuditEventsError({
  error,
  isRefreshing,
  onRetry,
}: {
  error: unknown;
  isRefreshing: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="border-destructive/30 bg-destructive/5 max-w-md rounded-md border p-4 text-center">
        <TriangleAlert className="text-destructive mx-auto size-5" />
        <div className="text-foreground mt-3 text-sm font-semibold">
          Could not load audit events.
        </div>
        <p className="text-muted-foreground mt-1 text-[13px] leading-5">{getErrorMessage(error)}</p>
        <Button
          className="mt-3"
          disabled={isRefreshing}
          onClick={onRetry}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={cn("size-3.5", isRefreshing ? "animate-spin" : "")} />
          Refresh
        </Button>
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Unexpected error while loading audit events.";
}
