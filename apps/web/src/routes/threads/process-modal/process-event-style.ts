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

export function statusChipClassName(status: ThreadProcessEvent["status"]): string | null {
  if (status === "error") {
    return "border-destructive/20 bg-destructive/[0.06] text-destructive";
  }

  if (status === "unsupported") {
    return "border-border bg-muted/50 text-fg-3";
  }

  return null;
}

export function getTimelineSegmentFlexGrow(event: ThreadProcessEvent): number {
  return Math.max(event.durationMs ?? 1, 1);
}
