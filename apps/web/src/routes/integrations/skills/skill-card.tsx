import type { SkillSummary } from "@mosoo/contracts/skill";

import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { formatSkillFileCount } from "@/shared/ui/skill-file-count-badge";

export function SkillCard({ onOpen, skill }: { onOpen: () => void; skill: SkillSummary }) {
  const { t } = useTranslation();
  const updatedDate = new Date(skill.updatedAt).toLocaleDateString(getCurrentLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group text-left relative flex flex-col min-h-[168px] gap-3 rounded-lg border border-border bg-card p-4 cursor-pointer transition-[border-color,box-shadow] duration-150 ease-out",
        "hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      <div className="min-w-0">
        <div className="text-fg-heading truncate text-[14px] font-semibold">{skill.name}</div>
      </div>

      <p className="text-fg-2 line-clamp-3 text-[12.5px] leading-relaxed">{skill.description}</p>

      <div className="flex-1" />

      <div className="text-fg-3 flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{skill.ownerName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 whitespace-nowrap">
            {formatSkillFileCount(skill.fileCount, t)}
          </span>
        </span>
        <span className="shrink-0 font-mono tabular-nums">
          {t("skills.updated", { date: updatedDate })}
        </span>
      </div>
    </button>
  );
}
