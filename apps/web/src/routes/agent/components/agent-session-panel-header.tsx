import { FolderOpen, Plus } from "lucide-react";
import type React from "react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

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
  onStartNewSession,
  pill,
  reconnectingSubtitle,
  sending,
  sessionCount,
  sessionFilesCount,
  tone,
}: {
  activeTitle: string | null;
  agentName: string;
  filesPanelOpen: boolean;
  onFilesPanelToggle: () => void;
  onStartNewSession: () => Promise<void>;
  pill: SessionPill;
  reconnectingSubtitle: string | null;
  sending: boolean;
  sessionCount: number;
  sessionFilesCount: number;
  tone: "preview" | "consume";
}) {
  return (
    <div className="border-border-subtle flex h-10 shrink-0 items-center gap-2 border-b bg-white px-4">
      <div className={cn("size-2 rounded-full", sessionIndicatorClassName(pill))} />
      <span className="text-foreground min-w-0 truncate text-[12px] font-medium">
        {tone === "preview" ? `Testing — ${agentName}` : agentName}
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
      {sessionCount > 0 ? (
        <span className="text-muted-foreground text-[10.5px]">{sessionCount} sessions</span>
      ) : null}
      <Button
        className="gap-1.5"
        disabled={sending}
        onClick={() => void onStartNewSession()}
        size="xs"
        variant="ghost"
      >
        <Plus className="size-3" />
        New session
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
