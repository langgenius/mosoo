import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { getSessionEventChipTone, getSessionEventLabel } from "@/shared/ui/session-events";

import type { ThreadProcessEvent } from "../model/process";
import { formatDuration, formatOffset, formatTokens } from "./format";
import { statusChipClassName } from "./process-event-style";

interface ProcessEventRowProps {
  event: ThreadProcessEvent;
  expanded: boolean;
  index: number;
  offsetMs: number;
  onSelect: () => void;
  onToggleExpanded: () => void;
  selected: boolean;
}

export function ProcessEventRow({
  event,
  expanded,
  index,
  offsetMs,
  onSelect,
  onToggleExpanded,
}: ProcessEventRowProps): ReactElement {
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
