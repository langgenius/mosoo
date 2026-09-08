import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Row recipes (docs/design/console-design-contract.md, section 4).
 *
 * `DataRow` is the 40px data/list row (Runs, Environments, runtime rows,
 * token tables). `ConnectionRow` is the 44px integration/credential row (MCP
 * servers, provider keys). Both are minimums: multiline content grows the row
 * by whole line-heights instead of being clamped, so the vertical rhythm
 * survives long English and CJK copy. Hover and selected fills are the
 * neutral interaction tokens; the brand green never marks a row.
 *
 * `tone="tinted"` is the nested variant that sits inside a card (sunken
 * surface, 10px radius, one rung below the 14px card); `tone="flat"` is a row
 * inside a bordered list that separates rows with hairlines.
 */
type RowTone = "flat" | "tinted";

interface RowProps extends ComponentProps<"div"> {
  interactive?: boolean;
  selected?: boolean;
  tone?: RowTone;
}

const ROW_BASE =
  "flex items-center gap-3 px-3 text-[13px] transition-[background-color] duration-150 ease-out focus-within:relative focus-within:z-10";

const ROW_TONE: Record<RowTone, string> = {
  flat: "",
  tinted: "rounded-md bg-sunken",
};

function rowClassName(options: {
  className?: string | undefined;
  interactive: boolean;
  selected: boolean;
  size: string;
  tone: RowTone;
}): string {
  return cn(
    ROW_BASE,
    options.size,
    ROW_TONE[options.tone],
    options.interactive && (options.tone === "tinted" ? "hover:bg-paper-300" : "hover:bg-hover"),
    options.selected && "bg-selected",
    options.className,
  );
}

export function DataRow({
  className,
  interactive = false,
  selected = false,
  tone = "flat",
  ...props
}: RowProps): ReactElement {
  return (
    <div
      data-slot="data-row"
      data-selected={selected ? "true" : undefined}
      className={rowClassName({ className, interactive, selected, size: "min-h-10 py-2", tone })}
      {...props}
    />
  );
}

export function ConnectionRow({
  className,
  interactive = false,
  selected = false,
  tone = "flat",
  ...props
}: RowProps): ReactElement {
  return (
    <div
      data-slot="connection-row"
      data-selected={selected ? "true" : undefined}
      className={rowClassName({ className, interactive, selected, size: "min-h-11 py-2.5", tone })}
      {...props}
    />
  );
}

/** Bordered list surface that stacks flat rows with hairline separators. */
export function RowList({ className, ...props }: ComponentProps<"div">): ReactElement {
  return (
    <div
      data-slot="row-list"
      className={cn(
        "divide-y divide-border-soft overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}
