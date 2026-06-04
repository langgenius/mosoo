import type { ThreadProcessEvent, ThreadProcessVariant } from "../model/process";

export const VARIANT_ORDER: ThreadProcessVariant[] = [
  "Agent",
  "exec_command",
  "Web Search",
  "Web Fetch",
  "Read",
  "Write",
  "Tool",
];

export const VARIANT_TONE: Record<
  ThreadProcessVariant,
  { bar: string; chip: string; swatch: string }
> = {
  Agent: {
    bar: "bg-green-500",
    chip: "border-green-200 bg-green-50 text-green-800",
    swatch: "bg-green-500",
  },
  exec_command: {
    bar: "bg-green-600",
    chip: "border-green-200 bg-green-50 text-green-800",
    swatch: "bg-green-600",
  },
  Read: {
    bar: "bg-ink-300",
    chip: "border-ink-100 bg-ink-50 text-ink-700",
    swatch: "bg-ink-300",
  },
  Tool: {
    bar: "bg-amber",
    chip: "border-amber/30 bg-amber-bg text-amber-fg",
    swatch: "bg-amber",
  },
  "Web Fetch": {
    bar: "bg-sky",
    chip: "border-sky/30 bg-sky-bg text-sky-fg",
    swatch: "bg-sky",
  },
  "Web Search": {
    bar: "bg-sky/70",
    chip: "border-sky/25 bg-sky-bg text-sky-fg",
    swatch: "bg-sky/70",
  },
  Write: {
    bar: "bg-soil",
    chip: "border-soil/25 bg-soil-bg text-soil-fg",
    swatch: "bg-soil",
  },
};

export function statusChipClassName(status: ThreadProcessEvent["status"]): string | null {
  if (status === "error") {
    return "border-ember/25 bg-ember-bg text-ember-fg";
  }

  if (status === "unsupported") {
    return "border-border bg-muted/50 text-fg-3";
  }

  return null;
}

export function getTimelineSegmentFlexGrow(event: ThreadProcessEvent): number {
  return Math.max(event.durationMs ?? 1, 1);
}
