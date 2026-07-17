import { ArrowRight, Check, Globe } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";

import type { Agent } from "../agent.types";
import { AgentApiAccessPanel } from "./api-access-panel";
import { buildAgentDistribution } from "./distribution-info";

export function PublishSuccessModal({
  agent,
  onOpenChange,
  onViewDistribution,
  open,
}: {
  agent: Agent;
  onOpenChange: (open: boolean) => void;
  onViewDistribution?: () => void;
  open: boolean;
}) {
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);

  function openThreadDialog(): void {
    globalThis.location.assign(distribution.threadsPath);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden rounded-lg p-0 sm:max-w-[540px]">
        <DialogHeader className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-3">
            <div className="mosoo-success-pop flex size-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-800">
              <Check className="size-5" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[16px]">Published "{agent.name}"</DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px]">
                Allowed callers can reach this agent now. Personal-token authenticated,
                access-gated.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-2.5 overflow-y-auto px-6 pb-2">
          <div className="border-border-subtle bg-card rounded-lg border px-3.5 py-3">
            <div className="flex items-start gap-3">
              <Globe className="text-fg-3 mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-foreground text-[13px] font-medium">Try in Mosoo</div>
                <div className="text-fg-2 mt-0.5 text-[12px]">Start a Thread with this agent.</div>
              </div>
              <Button
                className="gap-1 text-[11.5px]"
                onClick={openThreadDialog}
                size="xs"
                variant="outline"
              >
                Open
                <ArrowRight className="size-3" />
              </Button>
            </div>
          </div>

          <AgentApiAccessPanel agent={agent} />
        </div>

        {onViewDistribution ? (
          <>
            <Separator />
            <div className="flex justify-end gap-2 px-6 py-3">
              <Button onClick={onViewDistribution} size="sm" variant="outline">
                View distribution
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
