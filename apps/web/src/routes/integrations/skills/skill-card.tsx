import type { SkillSummary } from "@mosoo/contracts/skill";

import { cn } from "@/shared/lib/class-names";

import { formatDate } from "./format";

export function SkillCard({ onOpen, skill }: { onOpen: () => void; skill: SkillSummary }) {
  const sourceLabel = skill.sourceKind === "official" ? "Official" : skill.ownerName;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group text-left relative flex flex-col min-h-[168px] gap-3 rounded-lg border border-border bg-card p-4 cursor-pointer transition-all",
        "hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <div className="min-w-0">
        <div className="text-fg-1 truncate text-[14px] font-bold">{skill.name}</div>
      </div>

      <p className="text-fg-2 line-clamp-3 text-[12.5px] leading-relaxed">{skill.description}</p>

      <div className="flex-1" />

      <div className="text-fg-3 flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 truncate">
          <span aria-hidden className="text-amber">
            ●
          </span>
          {sourceLabel}
        </span>
        <span className="shrink-0 font-mono tabular-nums">
          Updated {formatDate(skill.updatedAt)}
        </span>
      </div>
    </button>
  );
}
