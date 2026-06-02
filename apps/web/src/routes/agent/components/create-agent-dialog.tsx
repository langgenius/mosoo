import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { createAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { RuntimeId } from "../agent.types";
import { RUNTIMES, getRuntimeInfo } from "../runtime-catalog";
import { RuntimeIcon } from "./shared-components";

const TITLE_STYLE = { letterSpacing: "0" } satisfies CSSProperties;

export function CreateAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeOrganization } = useAppSession();
  const [name, setName] = useState("");
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId | null>(null);
  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });

  function resetDialog(): void {
    setName("");
    setSelectedRuntime(null);
  }

  async function handleCreate(): Promise<void> {
    if (activeOrganization === null || selectedRuntime === null) {
      return;
    }

    try {
      const runtime = getRuntimeInfo(selectedRuntime);
      const createdAgent = await createAgentMutation.mutateAsync({
        kind: "pet",
        model: runtime.defaultModel,
        name: name.trim(),
        organizationId: activeOrganization.id,
        prompt: "",
        provider: runtime.provider,
        runtimeId: selectedRuntime,
        skillIds: [],
      });

      resetDialog();
      onOpenChange(false);
      void navigate(
        globalThis.location.pathname.startsWith("/demo")
          ? `/demo/agent/${createdAgent.id}`
          : `/agent/${createdAgent.id}`,
      );
    } catch {
      // Error state is surfaced from the mutation object.
    }
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      resetDialog();
    }

    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        className="gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[560px]"
      >
        <DialogHeader className="px-7 pt-7 pb-0">
          <DialogTitle className="text-[20px] font-light" style={TITLE_STYLE}>
            Create Agent
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Name your agent and choose a runtime.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-7 py-5">
          <div className="space-y-2">
            <Label htmlFor="agent-name" className="text-[13px]">
              Name
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g. PM Agent, Sales Assistant..."
              className="h-10 rounded-md"
            />
          </div>

          {/* Runtime picker */}
          <div>
            <Label className="mb-3 block text-[13px]">Runtime</Label>
            <div className="grid grid-cols-2 gap-3">
              {RUNTIMES.map((runtime) => (
                <button
                  key={runtime.id}
                  type="button"
                  onClick={() => {
                    setSelectedRuntime(runtime.id);
                  }}
                  className={cn(
                    "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3.5 transition-all",
                    selectedRuntime === runtime.id
                      ? "border-brand bg-brand-light shadow-sm"
                      : "border-border hover:border-brand/30 hover:bg-accent/30",
                  )}
                >
                  {selectedRuntime === runtime.id && (
                    <div className="bg-primary absolute top-2 right-2 flex size-5 items-center justify-center rounded-full">
                      <Check className="size-3 text-white" />
                    </div>
                  )}
                  <RuntimeIcon runtime={runtime} size={36} />
                  <div className="text-center">
                    <div className="text-[12px] font-medium">{runtime.name}</div>
                    <div className="text-muted-foreground text-[10px]">{runtime.vendor}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {createAgentMutation.error ? (
            <div className="text-destructive text-[12px]">
              {createAgentMutation.error instanceof Error
                ? createAgentMutation.error.message
                : "Failed to create agent."}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-7 pt-2 pb-6">
          <Button
            disabled={
              activeOrganization === null ||
              name.trim().length === 0 ||
              selectedRuntime === null ||
              createAgentMutation.isPending
            }
            onClick={() => void handleCreate()}
            className="px-6"
          >
            {createAgentMutation.isPending ? "Creating…" : "Create agent"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
