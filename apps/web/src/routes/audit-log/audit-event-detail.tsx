import { MousePointerClick, X } from "lucide-react";

import type { AuditEvent } from "@/domains/audit/api/audit-client";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { getCategory } from "./audit-log-model";

export function AuditEventDetail({
  event,
  onClose,
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  if (!event) {
    return <EmptyDetail />;
  }

  const resourceLabel = event.resourceDisplay ?? event.resourceId ?? "unknown resource";
  const actorOwner =
    getMetadataValue(event, ["ownerDisplay", "ownerName", "ownedBy", "owned_by"]) ??
    getMetadataValue(event, ["owner_at_time_display", "owner_at_time_id"]);
  const actorLabel =
    event.actor.type === "api_key"
      ? `${event.actor.display} · owned by ${actorOwner ?? "unknown owner"}`
      : event.actor.display;
  const actorEmail = getMetadataValue(event, ["actorEmail", "ownerEmail"]);

  return (
    <div className="space-y-5">
      <div className="relative pr-8">
        <Button
          aria-label="Close detail"
          className="absolute top-0 right-0"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
        <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
          Event · {getCategory(event.action)}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <h2 className="text-foreground min-w-0 truncate font-mono text-sm font-semibold">
            {event.action}
          </h2>
          <OutcomeBadge outcome={event.outcome} />
        </div>
        <p
          className={cn(
            "text-muted-foreground mt-3 text-sm leading-5",
            event.outcome === "denied" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {event.actor.display} · {event.action} · {resourceLabel}
        </p>
      </div>

      <section>
        <SectionEyebrow>Actor</SectionEyebrow>
        <div className="border-border bg-background space-y-2 rounded-md border p-3 text-sm">
          <div className="text-foreground max-w-full truncate font-medium">{actorLabel}</div>
          <div className="text-muted-foreground text-[12px]">
            {actorEmail ?? (event.actor.type === "user" ? "Email unavailable" : event.actor.type)}
          </div>
          <div className="text-muted-foreground font-mono text-[12px] break-words">
            {event.actor.id ?? "no actor id"}
          </div>
        </div>
      </section>

      <section>
        <SectionEyebrow>Context</SectionEyebrow>
        <div className="grid gap-2 text-sm">
          {[
            ["Event ID", event.id],
            ["Timestamp", new Date(event.timestamp).toLocaleString()],
            ["Outcome", event.outcome],
            ["Resource", `${event.resourceType} / ${resourceLabel}`],
            ["IP", event.ipAddress ?? "unknown"],
            ["User agent", event.userAgent ?? "unknown"],
            ["Session", event.sessionId ?? "none"],
          ].map(([label, value]) => (
            <div key={label} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
              <span className="text-muted-foreground">{label}</span>
              {label === "Resource" ? (
                <span className="bg-muted text-foreground min-w-0 justify-self-start rounded-md px-2 py-0.5 font-medium break-words">
                  {value}
                </span>
              ) : (
                <span
                  className="text-foreground min-w-0 font-mono text-[12px] break-words"
                  suppressHydrationWarning={label === "Timestamp"}
                >
                  {value}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <EventSnapshots event={event} />

      <section>
        <SectionEyebrow>Metadata</SectionEyebrow>
        {Object.keys(event.metadata).length > 0 ? (
          <pre className="bg-muted/40 text-foreground max-h-64 overflow-auto rounded-md p-3 text-[12px] break-words whitespace-pre-wrap">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        ) : (
          <div className="text-muted-foreground text-xs">No additional context.</div>
        )}
      </section>
    </div>
  );
}

function EventSnapshots({ event }: { event: AuditEvent }) {
  const beforeEntries = Object.entries(event.before);
  const afterEntries = Object.entries(event.after);

  if (beforeEntries.length === 0 && afterEntries.length === 0) {
    return (
      <section>
        <SectionEyebrow>Before / After</SectionEyebrow>
        <div className="text-muted-foreground text-xs">No before or after snapshot.</div>
      </section>
    );
  }

  if (beforeEntries.length === 0) {
    return (
      <section>
        <SectionEyebrow>After</SectionEyebrow>
        <SnapshotFieldList entries={afterEntries} />
      </section>
    );
  }

  if (afterEntries.length === 0) {
    return (
      <section>
        <SectionEyebrow>Before</SectionEyebrow>
        <SnapshotFieldList entries={beforeEntries} />
      </section>
    );
  }

  return (
    <section>
      <SectionEyebrow>Before / After</SectionEyebrow>
      <div className="grid gap-3 lg:grid-cols-2">
        <SnapshotFieldList entries={beforeEntries} title="Before" />
        <SnapshotFieldList entries={afterEntries} title="After" />
      </div>
    </section>
  );
}

function SnapshotFieldList({
  entries,
  title,
}: {
  entries: [string, AuditEvent["before"][string]][];
  title?: string | undefined;
}) {
  return (
    <div className="space-y-2">
      {title ? <div className="text-muted-foreground text-[11px] font-medium">{title}</div> : null}
      {entries.map(([key, value]) => (
        <div key={key} className="border-border-subtle rounded-md border">
          <div className="border-border-subtle text-muted-foreground border-b px-3 py-1.5 font-mono text-[11px]">
            {key}
          </div>
          <StringifiedSnapshotValue value={value} />
        </div>
      ))}
    </div>
  );
}

function StringifiedSnapshotValue({ value }: { value: AuditEvent["before"][string] }) {
  if (value === "[redacted]") {
    return (
      <div className="text-muted-foreground bg-muted/30 px-3 py-2 font-mono text-[12px]">
        [redacted]
      </div>
    );
  }

  return (
    <pre className="bg-muted/30 text-foreground max-h-56 overflow-auto px-3 py-2 text-[12px] break-words whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function SectionEyebrow({ children }: { children: string }) {
  return (
    <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
      {children}
    </h3>
  );
}

function OutcomeBadge({ outcome }: { outcome: AuditEvent["outcome"] }) {
  if (outcome === "success") {
    return <span className="text-muted-foreground text-[12px]">success</span>;
  }

  return (
    <Badge
      className={cn(
        "capitalize",
        outcome === "denied" ? "border-destructive text-destructive" : "border-amber text-soil",
      )}
      variant="outline"
    >
      {outcome}
    </Badge>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="border-border-subtle bg-background flex size-12 items-center justify-center rounded-full border">
        <MousePointerClick className="text-muted-foreground size-5" />
      </div>
      <div className="text-foreground mt-4 text-[15px] font-semibold">No event selected</div>
      <p className="text-muted-foreground mt-1.5 max-w-[260px] text-[13px] leading-5">
        Pick an event from the list to inspect its actor, context, and before / after snapshot.
      </p>
    </div>
  );
}

function getMetadataValue(event: AuditEvent, keys: string[]): string | null {
  for (const key of keys) {
    const value = event.metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}
