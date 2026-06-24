import type { AppId } from "@mosoo/contracts/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { createAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { useVendorCredentialsQuery } from "@/domains/vendor-credential/model/provider-credential-query";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { RuntimeInfo } from "../agent.types";
import { isRuntimeSelectable, listRuntimeOptions } from "../runtime-catalog";
import { resolveDefaultAgentRuntime } from "../runtime-default";
import { RuntimeIcon } from "./runtime-icon";

const DEFAULT_AGENT_NAME = "Untitled agent";

export function CreateAgentLauncherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { activeOrganization, activeApp } = useAppSession();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="gap-0 overflow-hidden rounded-lg sm:max-w-[460px]">
        {activeOrganization === null ? (
          <LauncherStatus message="Finish App setup before creating agents." />
        ) : activeApp === null ? (
          <LauncherStatus message="Create an App before creating agents." />
        ) : (
          <CreateAgentLauncherBody onOpenChange={onOpenChange} appId={activeApp.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateAgentLauncherBody({
  onOpenChange,
  appId,
}: {
  onOpenChange: (open: boolean) => void;
  appId: AppId;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { credentials, loading: credentialsLoading } = useVendorCredentialsQuery(appId);

  const [name, setName] = useState("");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);

  const defaultRuntime = useMemo(
    () => (credentialsLoading ? null : resolveDefaultAgentRuntime(credentials)),
    [credentials, credentialsLoading],
  );
  const runtimeOptions = useMemo(
    () =>
      listRuntimeOptions(defaultRuntime?.runtimeId).filter((runtime) =>
        isRuntimeSelectable(runtime.id),
      ),
    [defaultRuntime],
  );

  const activeRuntimeId = selectedRuntimeId ?? defaultRuntime?.runtimeId ?? null;

  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });

  const trimmedName = name.trim();
  const canSubmit =
    !credentialsLoading &&
    defaultRuntime !== null &&
    activeRuntimeId !== null &&
    trimmedName.length > 0 &&
    !createAgentMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (defaultRuntime === null || activeRuntimeId === null || trimmedName.length === 0) {
      return;
    }

    const runtimeConfig = resolveRuntimeConfig(activeRuntimeId, defaultRuntime, runtimeOptions);

    try {
      const createdAgent = await createAgentMutation.mutateAsync({
        kind: "pet",
        model: runtimeConfig.model,
        name: trimmedName,
        appId,
        prompt: "",
        provider: runtimeConfig.provider,
        runtimeId: runtimeConfig.runtimeId,
        skillIds: [],
      });

      onOpenChange(false);
      void navigate(
        globalThis.location.pathname.startsWith("/demo")
          ? `/demo/agent/${createdAgent.id}?tab=preview`
          : `/agent/${createdAgent.id}?tab=preview`,
      );
    } catch {
      // Error state is rendered from the mutation object.
    }
  }

  const noRuntimeAvailable = !credentialsLoading && defaultRuntime === null;
  const mutationError =
    createAgentMutation.error instanceof Error ? createAgentMutation.error.message : null;
  const error = noRuntimeAvailable ? "Configure a provider before creating agents." : mutationError;

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader className="px-6 pt-6">
        <DialogTitle className="text-[16px]">New Agent</DialogTitle>
      </DialogHeader>

      <div className="space-y-5 px-6 py-5">
        <div className="space-y-2">
          <Label className="text-muted-foreground text-[12px]" htmlFor="new-agent-name">
            Name
          </Label>
          <Input
            id="new-agent-name"
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder={DEFAULT_AGENT_NAME}
            value={name}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground text-[12px]">Runtime</Label>
          {credentialsLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-2 text-[13px]">
              <Loader2 className="size-4 animate-spin" />
              Loading runtimes…
            </div>
          ) : runtimeOptions.length === 0 ? (
            <div className="text-muted-foreground text-[13px]">No runtimes available.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {runtimeOptions.map((runtime) => {
                const selected = runtime.id === activeRuntimeId;

                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "focus-visible:ring-brand-ring flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                      selected
                        ? "border-brand bg-brand-light"
                        : "border-border hover:border-brand/30",
                    )}
                    key={runtime.id}
                    onClick={() => {
                      setSelectedRuntimeId(runtime.id);
                    }}
                    type="button"
                  >
                    <RuntimeIcon runtime={runtime} size={24} />
                    <div className="min-w-0">
                      <div className="text-foreground text-[13px] font-medium">{runtime.name}</div>
                      <div className="text-muted-foreground text-[11px]">{runtime.vendor}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error !== null ? <div className="text-destructive text-[13px]">{error}</div> : null}
      </div>

      <DialogFooter className="border-border-subtle border-t px-6 py-4">
        <Button
          onClick={() => {
            onOpenChange(false);
          }}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={!canSubmit} type="submit">
          {createAgentMutation.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

function resolveRuntimeConfig(
  runtimeId: string,
  defaultRuntime: { model: string; provider: string; runtimeId: string },
  runtimeOptions: readonly RuntimeInfo[],
): { model: string; provider: string; runtimeId: string } {
  // Keep the resolved provider/model when the user keeps the default runtime, so
  // custom-provider credentials (e.g. OpenAI-compatible) stay wired correctly.
  if (runtimeId === defaultRuntime.runtimeId) {
    return defaultRuntime;
  }

  const runtime = runtimeOptions.find((candidate) => candidate.id === runtimeId);

  if (runtime === undefined) {
    return defaultRuntime;
  }

  return {
    model: runtime.defaultModel,
    provider: runtime.provider,
    runtimeId: runtime.id,
  };
}

function LauncherStatus({ message }: { message: string }): ReactElement {
  return (
    <div className="text-muted-foreground px-7 py-10 text-center text-[13px]">
      <DialogTitle className="sr-only">Create agent</DialogTitle>
      {message}
    </div>
  );
}
