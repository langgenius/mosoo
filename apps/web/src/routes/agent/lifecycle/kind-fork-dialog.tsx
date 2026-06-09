import { ArrowRight, Bot, Check, Info, Plus, X, Zap } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { AgentKind } from "../agent.types";

const KIND_LABELS: Record<AgentKind, { title: string; tagline: string; icon: typeof Bot }> = {
  pet: { title: "Assistant Agent", tagline: "Always-on teammate", icon: Bot },
  cattle: { title: "Task Agent", tagline: "On-demand worker", icon: Zap },
};

const CARRIED_OVER = [
  "Manifest fields (name, description, model, prompt)",
  "Skills",
  "MCP server bindings",
  "Environment variables",
  "Setup script",
  "Space bindings",
];

const DROPPED_PET_TO_CATTLE = ["Assistant Agent stable Sandbox state"];

const ADDED_CATTLE_TO_PET = ["A new stable Assistant Agent Sandbox"];

const STAYS_ON_ORIGINAL = [
  "Existing sessions",
  "Cost history",
  "Runtime logs",
  "Assistant Agent stable Sandbox state",
];

export function KindForkDialog({
  agentName,
  currentKind,
  targetKind,
  open,
  busy = false,
  onCancel,
  onConfirm,
}: {
  agentName: string;
  currentKind: AgentKind;
  targetKind: AgentKind;
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const current = KIND_LABELS[currentKind];
  const target = KIND_LABELS[targetKind];
  const CurrentIcon = current.icon;
  const TargetIcon = target.icon;
  const isPetToCattle = currentKind === "pet" && targetKind === "cattle";
  const dropped = isPetToCattle ? DROPPED_PET_TO_CATTLE : [];
  const added = !isPetToCattle ? ADDED_CATTLE_TO_PET : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Fork agent to switch type</DialogTitle>
          <DialogDescription className="text-fg-2 text-[12.5px] leading-relaxed">
            Fork creates a new {target.title} with the same Manifest. The original {agentName} keeps
            its sessions, memory, and history. Continue?
          </DialogDescription>
        </DialogHeader>

        <div className="border-border-subtle bg-bg-1 rounded-lg border px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px]">
            <KindChip icon={CurrentIcon} label={current.title} tagline={current.tagline} muted />
            <ArrowRight className="text-fg-3 size-4 shrink-0" />
            <KindChip icon={TargetIcon} label={target.title} tagline={target.tagline} />
          </div>
        </div>

        <div className="space-y-3">
          <Section
            heading="Carried over to the fork"
            tone="positive"
            items={CARRIED_OVER}
            icon={Check}
          />

          {dropped.length > 0 ? (
            <Section heading="Dropped on switch" tone="warning" items={dropped} icon={X} />
          ) : null}

          {added.length > 0 ? (
            <Section heading="Added on switch" tone="info" items={added} icon={Plus} />
          ) : null}

          <Section
            heading={`Stays here on ${agentName}`}
            tone="muted"
            items={STAYS_ON_ORIGINAL}
            icon={Info}
          />
        </div>

        <DialogFooter>
          <Button disabled={busy} onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm} size="sm">
            {busy ? "Forking…" : `Fork as ${target.title}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindChip({
  icon: Icon,
  label,
  tagline,
  muted = false,
}: {
  icon: typeof Bot;
  label: string;
  tagline: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 ${
        muted ? "border-border text-fg-2 bg-white/60" : "border-border-strong bg-ink-100 text-fg-1"
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-foreground truncate text-[12.5px] font-semibold">{label}</div>
        <div className="text-fg-3 truncate text-[10.5px] tracking-wide uppercase">{tagline}</div>
      </div>
    </div>
  );
}

function Section({
  heading,
  items,
  icon: Icon,
  tone,
}: {
  heading: string;
  items: string[];
  icon: typeof Check;
  tone: "positive" | "warning" | "info" | "muted";
}) {
  const toneClass = {
    positive: "text-success-fg",
    warning: "text-amber-fg",
    info: "text-sky-fg",
    muted: "text-fg-3",
  }[tone];

  return (
    <div>
      <div className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${toneClass}`}>
        <Icon className="size-3.5" />
        <span className="tracking-wide uppercase">{heading}</span>
      </div>
      <ul className="text-foreground mt-1 space-y-0.5 pl-5 text-[12px] leading-relaxed">
        {items.map((item) => (
          <li key={item} className="list-disc">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
