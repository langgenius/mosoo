import { FolderOpen, Plus, RotateCcw } from "lucide-react";
import type React from "react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type { SessionControlMode } from "./agent-session-panel-rules";
import { sessionIndicatorClassName } from "./agent-session-panel-status";
import type { SessionPill } from "./agent-session-panel-status";

const PILL_VARIANTS: Record<SessionPill, React.ComponentProps<typeof Badge>["variant"]> = {
  "Needs approval": "warning",
  Ready: "success",
  "Setup required": "danger",
  Stopped: "outline",
  Working: "primary",
};

export function AgentSessionPanelHeader({
  activeTitle,
  agentName,
  filesPanelOpen,
  onFilesPanelToggle,
  onSessionControlClick,
  pill,
  reconnectingSubtitle,
  sessionControlMode,
  sending,
  sessionCount,
  sessionFilesCount,
  tone,
}: {
  activeTitle: string | null;
  agentName: string;
  filesPanelOpen: boolean;
  onFilesPanelToggle: () => void;
  onSessionControlClick: () => Promise<void>;
  pill: SessionPill;
  reconnectingSubtitle: string | null;
  sessionControlMode: SessionControlMode;
  sending: boolean;
  sessionCount: number;
  sessionFilesCount: number;
  tone: "preview" | "consume";
}) {
  const SessionControlIcon = sessionControlMode === "reset" ? RotateCcw : Plus;
  const sessionControlLabel = sessionControlMode === "reset" ? "Reset chat" : "New session";

  return (
    <div className="border-border-subtle flex h-10 shrink-0 items-center gap-2 border-b bg-white px-4">
      <div className={cn("size-2 rounded-full", sessionIndicatorClassName(pill))} />
      <span className="text-foreground min-w-0 truncate text-[12px] font-medium">
        {tone === "preview" ? `Testing ${agentName}` : agentName}
      </span>
      <Badge
        variant={PILL_VARIANTS[pill]}
        className="h-4 text-[10px]"
        data-testid="agent-session-pill"
      >
        {pill}
      </Badge>
      {reconnectingSubtitle ? (
        <span className="text-muted-foreground text-[10.5px]">{reconnectingSubtitle}</span>
      ) : null}
      {activeTitle ? (
        <span className="text-muted-foreground min-w-0 truncate text-[11px]">{activeTitle}</span>
      ) : null}
      <div className="flex-1" />
      {sessionControlMode === "new_session" && sessionCount > 0 ? (
        <span className="text-muted-foreground text-[10.5px]">{sessionCount} sessions</span>
      ) : null}
      <Button
        className="gap-1.5"
        disabled={sending}
        onClick={() => void onSessionControlClick()}
        size="xs"
        variant="ghost"
      >
        <SessionControlIcon className="size-3" />
        {sessionControlLabel}
      </Button>
      <Button
        aria-label="Toggle files panel"
        aria-pressed={filesPanelOpen}
        className="gap-1.5"
        onClick={onFilesPanelToggle}
        size="xs"
        variant={filesPanelOpen ? "outline" : "ghost"}
      >
        <FolderOpen className="size-3" />
        Files
        {sessionFilesCount > 0 ? (
          <span className="text-muted-foreground text-[10px]">{sessionFilesCount}</span>
        ) : null}
      </Button>
    </div>
  );
}
