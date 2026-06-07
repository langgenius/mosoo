import { agentKindSupportsResetState } from "@mosoo/contracts/agent";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, PowerOff, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useState } from "react";

import { resetAgentState, unpublishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentDeploymentVersionId, toAgentId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

import type { Agent } from "../agent.types";

function toRuntimeOperationTargetVersion(agent: Agent) {
  if (agent.status !== "published" || agent.liveVersion === null) {
    return null;
  }

  return {
    id: toAgentDeploymentVersionId(agent.liveVersion.id),
    versionNumber: agent.liveVersion.versionNumber,
  };
}

export function AgentSettingsDangerZone({ agent }: { agent: Agent }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmResetState, setConfirmResetState] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [resetConfirmValue, setResetConfirmValue] = useState("");
  const typedAgentId = toAgentId(agent.id);
  const resetAgentStateMutation = useMutation({
    mutationFn: resetAgentState,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.detail(variables.agentId) });
    },
  });
  const unpublishMutation = useMutation({
    mutationFn: async () => unpublishAgent(typedAgentId),
    onSuccess: async () => {
      setConfirmUnpublish(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.id) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
    },
  });
  const showResetAgentState = agentKindSupportsResetState(agent.kind);
  const showUnpublish = agent.status === "published";

  async function handleResetAgentState() {
    await resetAgentStateMutation.mutateAsync({
      agentId: typedAgentId,
      targetVersion: toRuntimeOperationTargetVersion(agent),
    });
    setResetConfirmValue("");
    setConfirmResetState(false);
  }

  function handleResetDialogOpenChange(nextOpen: boolean): void {
    setConfirmResetState(nextOpen);

    if (!nextOpen) {
      setResetConfirmValue("");
    }
  }

  return (
    <>
      <div className="space-y-3 px-6 py-5">
        <h3 className="text-destructive text-sm font-semibold">Danger zone</h3>

        <div className="divide-border border-border divide-y rounded-lg border">
          {showUnpublish ? (
            confirmUnpublish ? (
              <div className="space-y-2 p-3">
                <p className="text-foreground text-sm">
                  Unpublish <strong>{agent.name}</strong>?
                </p>
                <p className="text-muted-foreground text-xs">
                  New sessions stop accepting. Existing sessions, cost, and the live version stay
                  accessible. You can re-publish anytime; visibility is remembered.
                </p>
                {unpublishMutation.error ? (
                  <div className="text-destructive text-xs">
                    {unpublishMutation.error instanceof Error
                      ? unpublishMutation.error.message
                      : "Unpublish failed."}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={unpublishMutation.isPending}
                    onClick={() => {
                      setConfirmUnpublish(false);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    className="border-amber/45 text-amber-fg hover:bg-amber-bg hover:text-amber-fg"
                    disabled={unpublishMutation.isPending}
                    onClick={() => unpublishMutation.mutate()}
                    size="sm"
                    variant="outline"
                  >
                    <PowerOff className="size-3.5" />
                    {unpublishMutation.isPending ? "Unpublishing…" : "Unpublish"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-foreground text-sm font-medium">Unpublish this agent</div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Stop accepting new sessions. History stays. Re-publishable anytime.
                  </p>
                </div>
                <Button
                  className="border-amber/45 text-amber-fg hover:bg-amber-bg hover:text-amber-fg w-24 shrink-0"
                  onClick={() => {
                    setConfirmUnpublish(true);
                  }}
                  size="sm"
                  variant="outline"
                >
                  <PowerOff className="size-3.5" />
                  Unpublish
                </Button>
              </div>
            )
          ) : null}

          {showResetAgentState ? (
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">Reset agent-state</div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Clears login, cache, memory, and native session state.
                </p>
              </div>
              <Button
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive w-24 shrink-0"
                disabled={resetAgentStateMutation.isPending}
                onClick={() => {
                  setConfirmResetState(true);
                }}
                size="sm"
                variant="outline"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
          ) : null}

          {confirmDelete ? (
            <div className="space-y-2 p-3">
              <p className="text-foreground text-sm">
                Delete <strong>{agent.name}</strong> permanently?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="destructive" size="sm">
                  <Trash2 className="size-3.5" />
                  Delete agent
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">Delete this agent</div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Permanently remove this agent and all its records.
                </p>
              </div>
              <Button
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive w-24 shrink-0"
                onClick={() => {
                  setConfirmDelete(true);
                }}
                size="sm"
                variant="outline"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          )}
        </div>

        {resetAgentStateMutation.error ? (
          <div className="text-destructive text-xs">
            {resetAgentStateMutation.error instanceof Error
              ? resetAgentStateMutation.error.message
              : "Reset agent-state failed."}
          </div>
        ) : null}
      </div>

      <Dialog open={confirmResetState} onOpenChange={handleResetDialogOpenChange}>
        <DialogContent className="border-destructive/60 rounded-lg sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Reset agent-state for "{agent.name}"?</DialogTitle>
            <DialogDescription>
              This clears session runtime state and Agent memory for this Agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border-destructive/20 bg-destructive/[0.04] rounded-lg border p-3">
              <div className="border-destructive/20 bg-destructive/10 text-destructive inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold">
                <XCircle className="size-3.5" />
                <LockKeyhole className="size-3.5" />
                agent-state will be cleared
              </div>
              <div className="text-muted-foreground mt-3 space-y-3 text-xs leading-5">
                <div>
                  <div className="text-foreground font-medium">What will be cleared</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>Login state</li>
                    <li>Cache</li>
                    <li>Long-term memory</li>
                    <li>Native session state</li>
                  </ul>
                </div>
                <div>
                  <div className="text-foreground font-medium">What will be preserved</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>Agent profile, prompts, Skills, and MCP refs</li>
                    <li>Space files</li>
                    <li>Past sessions and transcripts</li>
                    <li>Cost history</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium" htmlFor="reset-agent-state">
                Type the agent name to confirm: {agent.name}
              </label>
              <Input
                placeholder="agent name"
                id="reset-agent-state"
                onChange={(event) => {
                  setResetConfirmValue(event.target.value);
                }}
                value={resetConfirmValue}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setConfirmResetState(false);
                  setResetConfirmValue("");
                }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  resetAgentStateMutation.isPending || resetConfirmValue.trim() !== agent.name
                }
                onClick={() => void handleResetAgentState()}
                size="sm"
                variant="destructive"
              >
                Reset agent-state
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
