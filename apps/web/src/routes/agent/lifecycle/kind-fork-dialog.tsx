import { ArrowRight, Bot, Check, Info, Plus, X, Zap } from "lucide-react";

import { useTranslation } from "@/shared/i18n";
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

const KIND_COPY: Record<AgentKind, { titleKey: string; taglineKey: string; icon: typeof Bot }> = {
  pet: { titleKey: "agent.assistantAgent", taglineKey: "agent.kindAssistantTagline", icon: Bot },
  cattle: { titleKey: "agent.taskAgent", taglineKey: "agent.kindTaskTagline", icon: Zap },
};

const CARRIED_OVER = [
  "agentLifecycle.forkCarriedManifestFields",
  "agent.skills",
  "agentLifecycle.forkCarriedMcpBindings",
  "agentLifecycle.forkCarriedEnvVars",
  "environments.setupScript",
];

const DROPPED_PET_TO_CATTLE = ["agentLifecycle.assistantSandboxState"];

const ADDED_CATTLE_TO_PET = ["agentLifecycle.forkAddedSandbox"];

const STAYS_ON_ORIGINAL = [
  "agentLifecycle.forkStaysSessions",
  "agent.costHistory",
  "agentLifecycle.forkStaysRuntimeLogs",
  "agentLifecycle.assistantSandboxState",
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
  const { t } = useTranslation();
  const current = KIND_COPY[currentKind];
  const target = KIND_COPY[targetKind];
  const CurrentIcon = current.icon;
  const TargetIcon = target.icon;
  const currentTitle = t(current.titleKey);
  const targetTitle = t(target.titleKey);
  const currentTagline = t(current.taglineKey);
  const targetTagline = t(target.taglineKey);
  const isPetToCattle = currentKind === "pet" && targetKind === "cattle";
  const dropped = isPetToCattle ? DROPPED_PET_TO_CATTLE.map((key) => t(key)) : [];
  const added = !isPetToCattle ? ADDED_CATTLE_TO_PET.map((key) => t(key)) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t("agentLifecycle.forkTitle")}</DialogTitle>
          <DialogDescription className="text-fg-2 text-[12.5px] leading-relaxed">
            {t("agentLifecycle.forkDescription", { agentName, target: targetTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="border-border-subtle bg-bg-1 rounded-lg border px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px]">
            <KindChip icon={CurrentIcon} label={currentTitle} tagline={currentTagline} muted />
            <ArrowRight className="text-fg-3 size-4 shrink-0" />
            <KindChip icon={TargetIcon} label={targetTitle} tagline={targetTagline} />
          </div>
        </div>

        <div className="space-y-3">
          <Section
            heading={t("agentLifecycle.forkCarriedOver")}
            tone="positive"
            items={CARRIED_OVER.map((key) => t(key))}
            icon={Check}
          />

          {dropped.length > 0 ? (
            <Section
              heading={t("agentLifecycle.forkDropped")}
              tone="warning"
              items={dropped}
              icon={X}
            />
          ) : null}

          {added.length > 0 ? (
            <Section
              heading={t("agentLifecycle.forkAdded")}
              tone="info"
              items={added}
              icon={Plus}
            />
          ) : null}

          <Section
            heading={t("agentLifecycle.forkStaysHere", { agentName })}
            tone="muted"
            items={STAYS_ON_ORIGINAL.map((key) => t(key))}
            icon={Info}
          />
        </div>

        <DialogFooter>
          <Button disabled={busy} onClick={onCancel} size="sm" variant="outline">
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={onConfirm} size="sm">
            {busy ? t("agentLifecycle.forking") : t("agentLifecycle.forkAs", { kind: targetTitle })}
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
