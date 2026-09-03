import {
  listAgentKindRuntimeComparisonRows,
  listAgentKindRuntimePolicies,
} from "@mosoo/contracts/agent";
import type { AgentKind } from "@mosoo/contracts/agent";
import { useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import {
  ChevronDown,
  Bot,
  Zap,
  Lock,
  Sparkles,
  Layers,
  AlertTriangle,
  Target,
} from "@/shared/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const CARDS = listAgentKindRuntimePolicies();
const COMPARE_ROWS = listAgentKindRuntimeComparisonRows();

const CARD_ICONS = {
  cattle: Zap,
  pet: Bot,
} as const satisfies Record<AgentKind, typeof Bot>;

const COMPARE_ICONS = {
  best_for: Target,
  cross_session_memory: Sparkles,
  failure_pattern: AlertTriangle,
  scaling: Layers,
  switch_cost: Lock,
} as const satisfies Record<(typeof COMPARE_ROWS)[number]["id"], typeof Sparkles>;

const CARD_COPY_KEYS = {
  cattle: {
    description: "agent.kindTaskDescription",
    examples: "agent.kindTaskExamples",
    label: "agent.taskAgent",
    tagline: "agent.kindTaskTagline",
  },
  pet: {
    description: "agent.kindAssistantDescription",
    examples: "agent.kindAssistantExamples",
    label: "agent.assistantAgent",
    tagline: "agent.kindAssistantTagline",
  },
} as const satisfies Record<
  AgentKind,
  Record<"description" | "examples" | "label" | "tagline", string>
>;

const COMPARISON_COPY_KEYS = {
  best_for: {
    cattle: "agent.kindComparisonBestForTask",
    label: "agent.kindComparisonBestFor",
    pet: "agent.kindComparisonBestForAssistant",
  },
  cross_session_memory: {
    cattle: "agent.kindComparisonMemoryTask",
    label: "agent.kindComparisonMemory",
    pet: "agent.kindComparisonMemoryAssistant",
  },
  failure_pattern: {
    cattle: "agent.kindComparisonFailureTask",
    label: "agent.kindComparisonFailure",
    pet: "agent.kindComparisonFailureAssistant",
  },
  scaling: {
    cattle: "agent.kindComparisonScalingTask",
    label: "agent.kindComparisonScaling",
    pet: "agent.kindComparisonScalingAssistant",
  },
  switch_cost: {
    cattle: "agent.kindComparisonSwitchCostTask",
    label: "agent.kindComparisonSwitchCost",
    pet: "agent.kindComparisonSwitchCostAssistant",
  },
} as const satisfies Record<
  (typeof COMPARE_ROWS)[number]["id"],
  Record<AgentKind | "label", string>
>;

export function KindSelector({
  value,
  locked,
  canFork = false,
  onChange,
  onFork,
  onLockedCardClick,
}: {
  value: AgentKind;
  locked: boolean;
  canFork?: boolean;
  onChange: (kind: AgentKind) => void;
  onFork?: () => void;
  onLockedCardClick?: (target: AgentKind) => void;
}) {
  const { t } = useTranslation();
  const [compareOpen, setCompareOpen] = useState(false);

  return (
    <section aria-label={t("agent.agentType")} className="border-border-subtle border-b pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-[13px] font-semibold">{t("agent.agentType")}</h2>
          <p className="text-fg-3 mt-0.5 text-[12px] leading-relaxed">
            {locked ? (
              <>
                {t("agent.typeLocked")}{" "}
                {canFork && onFork ? (
                  <button
                    className="text-brand focus-visible:ring-brand-ring rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    onClick={onFork}
                    type="button"
                  >
                    {t("agent.forkAgent")}
                  </button>
                ) : (
                  t("agent.contactOwnerToFork")
                )}
              </>
            ) : (
              t("agent.chooseAgentType")
            )}
          </p>
        </div>

        <div
          role="tablist"
          aria-label={t("agent.agentType")}
          className="border-border-subtle bg-bg-1 inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
        >
          {CARDS.map((card) => {
            const Icon = CARD_ICONS[card.kind];
            const copyKeys = CARD_COPY_KEYS[card.kind];
            const selected = value === card.kind;
            const isLockedAlternative = locked && !selected;

            return (
              <Tooltip key={card.kind}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      if (locked) {
                        if (!selected) {
                          onLockedCardClick?.(card.kind);
                        }
                        return;
                      }
                      if (!selected) {
                        onChange(card.kind);
                      }
                    }}
                    className={cn(
                      "focus-visible:ring-brand-ring inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      selected
                        ? "text-foreground bg-white shadow-sm"
                        : "text-fg-2 hover:text-foreground",
                      isLockedAlternative && "cursor-pointer",
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span>{t(copyKeys.label)}</span>
                    {isLockedAlternative ? <Lock className="size-3 opacity-70" /> : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-left">
                  <div className="text-[12px] font-semibold">{t(copyKeys.label)}</div>
                  <div className="mt-0.5 text-[10.5px] tracking-wide uppercase opacity-70">
                    {t(copyKeys.tagline)}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed">{t(copyKeys.description)}</p>
                  <p className="mt-1 text-[11px] italic opacity-80">{t(copyKeys.examples)}</p>
                  {isLockedAlternative ? (
                    <p className="mt-1.5 text-[11px] font-medium opacity-90">
                      {t("agent.forkToSwitchType")}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        aria-expanded={compareOpen}
        onClick={() => setCompareOpen((open) => !open)}
        className="text-fg-2 hover:text-brand focus-visible:ring-brand-ring -my-1 mt-3 inline-flex min-h-6 items-center gap-1 rounded-sm py-1 text-[12px] font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", compareOpen && "rotate-180")} />
        {compareOpen ? t("agent.hideComparison") : t("agent.compareTypes")}
      </button>

      {compareOpen ? (
        <div className="border-border-subtle mt-2 overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="bg-bg-1 text-fg-3 text-[11px] tracking-wide uppercase">
              <tr>
                <th className="w-[140px] px-3 py-2 font-medium">{t("agent.dimension")}</th>
                <th className="text-foreground px-3 py-2 font-medium">
                  {t("agent.assistantAgent")}
                </th>
                <th className="text-foreground px-3 py-2 font-medium">{t("agent.taskAgent")}</th>
              </tr>
            </thead>
            <tbody className="divide-border-subtle divide-y">
              {COMPARE_ROWS.map((row) => {
                const rowId = row.id as keyof typeof COMPARISON_COPY_KEYS;
                const Icon = COMPARE_ICONS[rowId];
                const copyKeys = COMPARISON_COPY_KEYS[rowId];
                return (
                  <tr key={row.id} className="bg-white">
                    <td className="text-fg-2 px-3 py-2 align-top">
                      <div className="flex items-center gap-1.5">
                        <Icon className="text-fg-3 size-3" />
                        {t(copyKeys.label)}
                      </div>
                    </td>
                    <td className="text-foreground px-3 py-2 align-top">{t(copyKeys.pet)}</td>
                    <td className="text-foreground px-3 py-2 align-top">{t(copyKeys.cattle)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
