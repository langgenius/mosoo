import type { ReactElement } from "react";

import type { ThreadProcessEvent } from "../model/process";
import { formatTotalDuration } from "./format";
import { ProcessTimelineBar } from "./process-timeline-bar";

interface ProcessTimelineProps {
  events: readonly ThreadProcessEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}

export function ProcessTimeline({
  events,
  onSelect,
  selectedId,
}: ProcessTimelineProps): ReactElement {
  const totalDurationMs = events.reduce((total, event) => total + (event.durationMs ?? 0), 0);

  return (
    <>
      <div className="text-fg-3 flex items-center justify-between text-[10.5px] tabular-nums">
        <span>0:00</span>
        <span>{formatTotalDuration(totalDurationMs)}</span>
      </div>
      <ProcessTimelineBar events={events} onSelect={onSelect} selectedId={selectedId} />
    </>
  );
}
