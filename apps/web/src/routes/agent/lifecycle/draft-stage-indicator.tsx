import { Check } from "lucide-react";
import { Fragment } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import type { AgentDraftStage } from "../draft-stages";

export function DraftStageIndicator({
  stages,
}: {
  stages: readonly AgentDraftStage[];
}): ReactElement {
  const activeIndex = stages.findIndex((stage) => !stage.complete);

  return (
    <div aria-label="Draft setup progress" className="flex items-center gap-1">
      {stages.map((stage, index) => {
        const isActive = index === activeIndex;

        return (
          <Fragment key={stage.id}>
            {index > 0 ? <div className="bg-border-subtle h-px w-3 shrink-0" /> : null}
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] leading-none whitespace-nowrap",
                stage.complete
                  ? "text-muted-foreground"
                  : isActive
                    ? "bg-brand-light text-foreground font-medium"
                    : "text-muted-foreground/60",
              )}
            >
              {stage.complete ? (
                <Check className="size-3 shrink-0" />
              ) : (
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[9px]",
                    isActive ? "border-brand text-brand" : "border-border",
                  )}
                >
                  {index + 1}
                </span>
              )}
              {stage.label}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
