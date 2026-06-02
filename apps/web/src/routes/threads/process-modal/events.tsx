import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import {
  SESSION_EVENT_DOMAIN_TONE,
  getSessionEventChipTone,
  getSessionEventDomain,
  getSessionEventLabel,
} from "@/shared/ui/session-events";

import type { ThreadProcessEvent, ThreadProcessVariant } from "../model/process";
import { formatDuration, formatOffset, formatTokens } from "./format";

const VARIANT_ORDER: ThreadProcessVariant[] = [
  "Agent",
  "exec_command",
  "Web Search",
  "Web Fetch",
  "Read",
  "Write",
  "Tool",
];

const VARIANT_TONE: Record<ThreadProcessVariant, { bar: string; chip: string; swatch: string }> = {
  Agent: {
    bar: "bg-purple-300",
    chip: "bg-purple-100 text-purple-800 border-purple-200",
    swatch: "bg-purple-300",
  },
  exec_command: {
    bar: "bg-emerald-300",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    swatch: "bg-emerald-300",
  },
  Read: {
    bar: "bg-teal-300",
    chip: "bg-teal-100 text-teal-800 border-teal-200",
    swatch: "bg-teal-300",
  },
  Tool: {
    bar: "bg-slate-300",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    swatch: "bg-slate-300",
  },
  "Web Fetch": {
    bar: "bg-sky-300",
    chip: "bg-sky-100 text-sky-800 border-sky-200",
    swatch: "bg-sky-300",
  },
  "Web Search": {
    bar: "bg-amber-300",
    chip: "bg-amber-100 text-amber-800 border-amber-200",
    swatch: "bg-amber-300",
  },
  Write: {
    bar: "bg-orange-300",
    chip: "bg-orange-100 text-orange-800 border-orange-200",
    swatch: "bg-orange-300",
  },
};

export function ProcessTimelineBar({
  events,
  onSelect,
  selectedId,
}: {
  events: readonly ThreadProcessEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}): ReactElement {
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

export function ProcessLegend(): ReactElement {
  return (
    <div className="text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
      {VARIANT_ORDER.map((variant) => (
        <span key={variant} className="inline-flex items-center gap-1">
          <span className={cn("size-2 rounded-sm", VARIANT_TONE[variant].swatch)} />
          <span>{variant}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="border-border bg-muted size-2 rounded-sm border" />
        <span>Unsupported</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="border-destructive/40 bg-destructive/40 size-2 rounded-sm border" />
        <span>Error</span>
      </span>
    </div>
  );
}

export function ProcessEventRow({
  event,
  expanded,
  index,
  offsetMs,
  onSelect,
  onToggleExpanded,
}: {
  event: ThreadProcessEvent;
  expanded: boolean;
  index: number;
  offsetMs: number;
  onSelect: () => void;
  onToggleExpanded: () => void;
  selected: boolean;
}): ReactElement {
  const chipTone = getSessionEventChipTone(event);
  const statusOverride = statusChipClassName(event.status);
  const chipClass = statusOverride ?? chipTone.chip;
  const preview = event.content.replaceAll(/\s+/g, " ").trim();
  const previewShort = preview.length > 220 ? `${preview.slice(0, 217)}...` : preview;

  return (
    <div className="border-border-subtle bg-card relative w-full overflow-hidden rounded-md border transition-colors">
      <button
        type="button"
        onClick={() => {
          onSelect();
          onToggleExpanded();
        }}
        className="grid w-full grid-cols-[12px_136px_minmax(0,1fr)_56px_56px_40px_56px] items-center gap-2 px-3 py-2 pl-4 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-fg-3 size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-fg-3 size-3 shrink-0" />
        )}

        <span
          className={cn(
            "inline-flex items-center justify-self-start whitespace-nowrap rounded-sm border px-1 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
            chipClass,
          )}
        >
          {getSessionEventLabel(event.type)}
        </span>

        <span className="text-fg-2 min-w-0 truncate text-[12.5px]">{previewShort}</span>

        <span className="text-fg-3 justify-self-end text-[11px] tabular-nums">
          {formatTokens(event.tokens)}
        </span>
        <span className="text-fg-3 justify-self-end text-[11px] tabular-nums">
          {formatDuration(event.durationMs)}
        </span>
        <span className="text-fg-3 justify-self-end font-mono text-[11px] tabular-nums">
          #{index + 1}
        </span>
        <span className="text-fg-3 justify-self-end font-mono text-[11px] tabular-nums">
          {formatOffset(offsetMs)}
        </span>
      </button>

      {expanded ? (
        <div className="border-border-subtle bg-muted/20 border-t px-3 py-2">
          <div className="text-fg-3 text-[10.5px] font-bold tracking-[0.14em] uppercase">
            content
          </div>
          <pre className="text-fg-2 mt-1 max-h-40 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {event.content}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function statusChipClassName(status: ThreadProcessEvent["status"]): string | null {
  if (status === "error") {
    return "border-destructive/20 bg-destructive/[0.06] text-destructive";
  }

  if (status === "unsupported") {
    return "border-border bg-muted/50 text-fg-3";
  }

  return null;
}

function getTimelineSegmentFlexGrow(event: ThreadProcessEvent): number {
  return Math.max(event.durationMs ?? 1, 1);
}
