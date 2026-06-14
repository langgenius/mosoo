import {
  listAgentKindRuntimeComparisonRows,
  listAgentKindRuntimePolicies,
} from "@mosoo/contracts/agent";
import type { AgentKind } from "@mosoo/contracts/agent";
import { ChevronDown, Bot, Zap, Lock, Sparkles, Layers, AlertTriangle, Target } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
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

export function KindSelector({
  value,
  locked,
  onChange,
  onLockedCardClick,
}: {
  value: AgentKind;
  locked: boolean;
  onChange: (kind: AgentKind) => void;
  onLockedCardClick?: (target: AgentKind) => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);

  return (
    <section aria-label="Agent type" className="border-border-subtle border-b pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-[13px] font-semibold">Agent type</h2>
          <p className="text-fg-3 mt-0.5 text-[12px] leading-relaxed">
            {locked
              ? "Locked after publishing. Fork to switch type."
              : "Choose how this agent runs. You can change this freely until you publish."}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Agent type"
          className="border-border-subtle bg-bg-1 inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
        >
          {CARDS.map((card) => {
            const Icon = CARD_ICONS[card.kind];
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
                    <span>{card.copy.label}</span>
                    {isLockedAlternative ? <Lock className="size-3 opacity-70" /> : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-left">
                  <div className="text-[12px] font-semibold">{card.copy.label}</div>
                  <div className="mt-0.5 text-[10.5px] tracking-wide uppercase opacity-70">
                    {card.copy.tagline}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed">{card.copy.description}</p>
                  <p className="mt-1 text-[11px] italic opacity-80">{card.copy.examples}</p>
                  {isLockedAlternative ? (
                    <p className="mt-1.5 text-[11px] font-medium opacity-90">Fork to switch type</p>
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
        {compareOpen ? "Hide comparison" : "Compare types"}
      </button>

      {compareOpen ? (
        <div className="border-border-subtle mt-2 overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="bg-bg-1 text-fg-3 text-[11px] tracking-wide uppercase">
              <tr>
                <th className="w-[140px] px-3 py-2 font-medium">Dimension</th>
                <th className="text-foreground px-3 py-2 font-medium">Assistant Agent</th>
                <th className="text-foreground px-3 py-2 font-medium">Task Agent</th>
              </tr>
            </thead>
            <tbody className="divide-border-subtle divide-y">
              {COMPARE_ROWS.map((row) => {
                const Icon = COMPARE_ICONS[row.id as keyof typeof COMPARE_ICONS];
                return (
                  <tr key={row.id} className="bg-white">
                    <td className="text-fg-2 px-3 py-2 align-top">
                      <div className="flex items-center gap-1.5">
                        <Icon className="text-fg-3 size-3" />
                        {row.label}
                      </div>
                    </td>
                    <td className="text-foreground px-3 py-2 align-top">{row.values.pet}</td>
                    <td className="text-foreground px-3 py-2 align-top">{row.values.cattle}</td>
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
