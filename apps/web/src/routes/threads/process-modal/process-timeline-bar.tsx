import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import {
  SESSION_EVENT_DOMAIN_TONE,
  getSessionEventDomain,
  getSessionEventLabel,
} from "@/shared/ui/session-events";

import type { ThreadProcessEvent } from "../model/process";
import { getTimelineSegmentFlexGrow } from "./process-event-style";

interface ProcessTimelineBarProps {
  events: readonly ThreadProcessEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}

export function ProcessTimelineBar({
  events,
  onSelect,
  selectedId,
}: ProcessTimelineBarProps): ReactElement {
  return (
    <div className="border-border-subtle bg-muted/10 flex h-7 min-w-0 items-center gap-0.5 overflow-hidden rounded-md border p-1">
      {events.map((event) => {
        const domain = getSessionEventDomain(event.type);
        const tone = SESSION_EVENT_DOMAIN_TONE[domain];
        const isSelected = selectedId === event.id;
        const isUnsupported = event.status === "unsupported";
        const isError = event.status === "error";

        return (
          <button
            key={event.id}
            type="button"
            onClick={() => {
              onSelect(event.id);
            }}
            aria-label={`Select ${getSessionEventLabel(event.type)}`}
            style={{ flexGrow: getTimelineSegmentFlexGrow(event) }}
            className={cn(
              "h-full min-w-[2px] rounded-[1px] border transition-colors text-[0]",
              isError
                ? "border-destructive/40 bg-destructive/40"
                : isUnsupported
                  ? "border-border bg-muted"
                  : cn("border-transparent", tone.bar),
              isSelected ? "ring-1 ring-ink-900/55 ring-inset" : "",
            )}
          />
        );
      })}
    </div>
  );
}
