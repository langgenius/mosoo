import type { AgentSummary } from "@mosoo/contracts/agent";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { SessionEventDrawerCore } from "@/shared/ui/session-events";

import { AgentAvatar } from "../agent-avatar";
import { createProcessCopyText } from "../model/process";
import type { ThreadProcessEvent } from "../model/process";
import { ProcessEventRow, ProcessLegend, ProcessTimeline } from "./events";
import { formatTokens, formatTotalDuration } from "./format";

interface ThreadProcessModalProps {
  agent: AgentSummary | null;
  agentName: string;
  errorMessage: string | null;
  events: ThreadProcessEvent[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  threadFailed: boolean;
  threadWorking: boolean;
}

export function ThreadProcessModal({
  agent,
  agentName,
  errorMessage,
  events,
  onOpenChange,
  open,
  threadFailed,
  threadWorking,
}: ThreadProcessModalProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const totalDurationMs = events.reduce((total, event) => total + (event.durationMs ?? 0), 0);
  const totalTokens = events.reduce((total, event) => total + (event.tokens ?? 0), 0);

  async function copyProcessEvents(): Promise<void> {
    await navigator.clipboard.writeText(createProcessCopyText({ agentName, events }));
    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1400);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-[1080px]">
        <DialogHeader className="border-border-subtle border-b px-7 pt-4 pb-3">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <AgentAvatar agent={agent} defaultName={agentName} className="size-7 text-[10px]" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-fg-1 text-[14px] font-semibold">
                    {agentName}
                  </DialogTitle>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                      threadFailed
                        ? "border-ember/25 bg-ember-bg text-ember-fg"
                        : "border-green-200 bg-success-bg text-success-fg",
                    )}
                  >
                    {threadWorking && !threadFailed ? (
                      <span
                        aria-hidden="true"
                        className="relative inline-flex size-2 items-center justify-center"
                      >
                        <span className="bg-primary absolute size-2 animate-ping rounded-full opacity-70" />
                        <span className="bg-primary relative size-2 rounded-full" />
                      </span>
                    ) : null}
                    {threadFailed ? "Failed" : threadWorking ? "Working" : "Completed"}
                  </span>
                </div>
                <DialogDescription className="text-fg-3 mt-0.5 text-[11.5px] tabular-nums">
                  {formatTotalDuration(totalDurationMs)} · {events.length} events ·{" "}
                  {formatTokens(totalTokens)} tokens
                </DialogDescription>
              </div>
            </div>
            <Button
              onClick={() => {
                void copyProcessEvents();
              }}
              size="sm"
              variant="outline"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogHeader>

        <SessionEventDrawerCore
          key={`${open}:${events[0]?.id ?? "none"}`}
          EventComponent={ProcessEventRow}
          emptyState={
            <div className="px-7 py-12 text-center">
              <div className="text-fg-1 text-sm font-semibold">No process events recorded</div>
              <div className="text-fg-3 mt-1 text-[12.5px]">
                {errorMessage ?? "The backend returned no durable events for this thread."}
              </div>
            </div>
          }
          events={events}
          LegendComponent={ProcessLegend}
          TimelineComponent={ProcessTimeline}
        />
      </DialogContent>
    </Dialog>
  );
}
