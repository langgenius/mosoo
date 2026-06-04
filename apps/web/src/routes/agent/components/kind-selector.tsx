import {
  listAgentKindRuntimeComparisonRows,
  listAgentKindRuntimePolicies,
} from "@mosoo/contracts/agent";
import type { AgentKind } from "@mosoo/contracts/agent";
import {
  ChevronDown,
  Bot,
  Zap,
  Check,
  X,
  Lock,
  Sparkles,
  Layers,
  AlertTriangle,
  Target,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";

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
    <section
      aria-label="Agent type"
      className="border-border-subtle rounded-xl border bg-white px-5 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-foreground text-[13.5px] font-semibold">Agent type</h2>
          <p className="text-fg-3 mt-0.5 text-[12px] leading-relaxed">
            {locked
              ? "Locked on this published agent. Fork to switch type."
              : "Choose how this agent runs. You can change this freely until you publish."}
          </p>
        </div>
        {locked ? (
          <div className="border-amber/30 bg-amber-bg text-amber-fg inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium">
            <Lock className="size-3" />
            Locked · Fork to switch
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = CARD_ICONS[card.kind];
          const selected = value === card.kind;
          const isCurrent = locked && selected;
          const isLockedAlternative = locked && !selected;

          return (
            <button
              key={card.kind}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                if (locked) {
                  if (!selected) {
                    onLockedCardClick?.(card.kind);
                  }
                  return;
                }
                onChange(card.kind);
              }}
              className={cn(
                "group relative flex flex-col items-start gap-2 rounded-lg border px-3.5 py-3 text-left transition-all",
                selected
                  ? "border-brand bg-brand-light/60 shadow-[0_0_0_1px_var(--brand)]"
                  : "border-border-subtle hover:border-brand/40 hover:bg-bg-1",
                isLockedAlternative && "cursor-pointer opacity-70 hover:opacity-100",
              )}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md",
                      selected ? "bg-brand text-white" : "bg-bg-2 text-fg-2",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground text-[13px] font-semibold">
                        {card.copy.label}
                      </span>
                      {isCurrent ? (
                        <span className="bg-brand/10 text-brand inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px text-[10px] font-medium">
                          <Check className="size-2.5" /> current
                        </span>
                      ) : null}
                      {isLockedAlternative ? (
                        <span className="bg-amber-bg text-amber-fg inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px text-[10px] font-medium">
                          <X className="size-2.5" /> Fork required
                        </span>
                      ) : null}
                    </div>
                    <div className="text-fg-3 text-[11px] tracking-wide uppercase">
                      {card.copy.tagline}
                    </div>
                  </div>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 size-3.5 shrink-0 rounded-full border transition-colors",
                    selected ? "border-brand bg-brand" : "border-border",
                  )}
                >
                  {selected ? (
                    <Check className="size-2.5 translate-x-px translate-y-px text-white" />
                  ) : null}
                </span>
              </div>

              <p className="text-fg-2 text-[12px] leading-relaxed">{card.copy.description}</p>
              <p className="text-fg-3 text-[11px] italic">{card.copy.examples}</p>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-expanded={compareOpen}
        onClick={() => setCompareOpen((open) => !open)}
        className="text-fg-2 hover:text-brand mt-3 inline-flex items-center gap-1 text-[12px] font-medium"
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
                <th className="text-foreground px-3 py-2 font-medium">Pet</th>
                <th className="text-foreground px-3 py-2 font-medium">Cattle</th>
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
