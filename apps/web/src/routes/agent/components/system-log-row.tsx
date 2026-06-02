import type { ReactElement } from "react";

import type { AgentRuntimeEvent } from "@/domains/session/api/agent-runtime-events";
import { cn } from "@/shared/lib/class-names";

import {
  familyBadgeClass,
  formatEventTimestamp,
  formatRelativeTime,
  shortSessionId,
} from "./system-log-model";

export function SystemLogRow({ event }: { event: AgentRuntimeEvent }): ReactElement {
  return (
    <div className="border-border-subtle border-b bg-white">
      <div className="grid w-full grid-cols-[112px_minmax(160px,260px)_96px_minmax(0,1fr)_112px] items-center gap-3 px-4 py-2.5 text-left">
        <span
          className="text-muted-foreground text-[11px] tabular-nums"
          title={formatEventTimestamp(event.createdAt)}
        >
          {formatRelativeTime(event.createdAt)}
        </span>
        <span className="text-foreground min-w-0 truncate font-mono text-[12px]">
          {event.eventType}
        </span>
        <span
          className={cn(
            "rounded-sm border px-1.5 py-0.5 text-center text-[10px] font-medium",
            familyBadgeClass(event.family),
          )}
        >
          {event.family}
        </span>
        <span className="text-muted-foreground min-w-0 truncate text-[12px]">{event.summary}</span>
        <span className="text-muted-foreground text-right font-mono text-[10.5px]">
          {shortSessionId(event.sessionId)}
        </span>
      </div>
    </div>
  );
}
