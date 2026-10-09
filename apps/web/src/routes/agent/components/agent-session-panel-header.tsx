import type React from "react";

import { useTranslation } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { RotateCcw } from "@/shared/ui/icons";

import type { SessionPill } from "./agent-session-panel-status";

const PILL_VARIANTS: Record<SessionPill, React.ComponentProps<typeof Badge>["variant"]> = {
  Ready: "success",
  "Setup required": "danger",
  Stopped: "outline",
  Working: "brand",
};

const PILL_LABEL_KEYS: Record<SessionPill, string> = {
  Ready: "agent.pillReady",
  "Setup required": "agent.setupRequired",
  Stopped: "agent.pillStopped",
  Working: "agent.pillWorking",
};

export function AgentSessionPanelHeader({
  activeTitle,
  agentName,
  onSessionControlClick,
  runtimeControls,
  pill,
  reconnectingSubtitle,
  sending,
}: {
  activeTitle: string | null;
  agentName: string;
  onSessionControlClick: () => Promise<void>;
  runtimeControls?: React.ReactNode;
  pill: SessionPill;
  reconnectingSubtitle: string | null;
  sending: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-border-soft bg-card flex h-10 shrink-0 items-center gap-2 border-b px-4">
      <span className="text-foreground min-w-0 truncate text-[12px] font-medium">
        {t("agent.testing", { name: agentName })}
      </span>
      <Badge variant={PILL_VARIANTS[pill]} data-testid="agent-session-pill">
        {t(PILL_LABEL_KEYS[pill])}
      </Badge>
      {reconnectingSubtitle ? (
        <span className="text-fg-3 text-[10.5px]">{reconnectingSubtitle}</span>
      ) : null}
      {activeTitle ? (
        <span className="text-fg-3 min-w-0 truncate text-[11px]">{activeTitle}</span>
      ) : null}
      <div className="flex-1" />
      {runtimeControls}
      <Button
        className="gap-1.5"
        disabled={sending}
        onClick={() => void onSessionControlClick()}
        size="xs"
        variant="ghost"
      >
        <RotateCcw className="size-3" />
        {t("agent.resetChat")}
      </Button>
    </div>
  );
}
