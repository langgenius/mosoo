import type { ProjectId } from "@mosoo/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session/session-context";
import { createAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { useVendorCredentialsQuery } from "@/domains/vendor-credential/model/provider-credential-query";
import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Loader2 } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { listRuntimeOptions } from "../runtime-catalog";
import { resolveDefaultAgentRuntime } from "../runtime-default";
import { RuntimeIcon } from "./runtime-icon";

export function CreateAgentLauncherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { activeOrganization, activeProject } = useAppSession();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-lg sm:max-w-[460px]">
        {activeOrganization === null ? (
          <LauncherStatus message={t("agent.finishSetup")} />
        ) : activeProject === null ? (
          <LauncherStatus message={t("agent.createProjectFirst")} />
        ) : (
          <CreateAgentLauncherBody onOpenChange={onOpenChange} projectId={activeProject.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateAgentLauncherBody({
  onOpenChange,
  projectId,
}: {
  onOpenChange: (open: boolean) => void;
  projectId: ProjectId;
}): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { credentials, loading: credentialsLoading } = useVendorCredentialsQuery(projectId);

  const [name, setName] = useState("");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);

  // The runtime catalog is static, so the cards render immediately. Credentials
  // only refine which runtime is preselected once they arrive.
  const runtimeOptions = listRuntimeOptions();
  const defaultRuntime = useMemo(
    () => (credentialsLoading ? null : resolveDefaultAgentRuntime(credentials)),
    [credentials, credentialsLoading],
  );

  const activeRuntimeId =
    selectedRuntimeId ?? defaultRuntime?.runtimeId ?? runtimeOptions[0]?.id ?? null;

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

    const runtimeConfig = resolveDefaultAgentRuntime(credentials, activeRuntimeId);

    if (runtimeConfig === null) {
      return;
    }

    try {
      const createdAgent = await createAgentMutation.mutateAsync({
        model: runtimeConfig.model,
        name: trimmedName,
        projectId,
        prompt: "",
        provider: runtimeConfig.provider,
        runtimeId: runtimeConfig.runtimeId,
        skillIds: [],
      });

      onOpenChange(false);
      void navigate(`/agent/${createdAgent.id}?tab=preview`);
    } catch {
      // Error state is rendered from the mutation object.
    }
  }

  const error =
    createAgentMutation.error instanceof Error ? createAgentMutation.error.message : null;

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader className="px-6 pt-6">
        <DialogTitle className="text-[16px]">{t("agent.newAgent")}</DialogTitle>
      </DialogHeader>

      <div className="space-y-5 px-6 py-5">
        <div className="space-y-2">
          <Label className="text-fg-3 text-[12px]" htmlFor="new-agent-name">
            {t("agent.name")}
          </Label>
          <Input
            id="new-agent-name"
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder={t("agent.untitled")}
            value={name}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-fg-3 text-[12px]">{t("agent.runtime")}</Label>
          <div className="grid grid-cols-2 gap-3">
            {runtimeOptions.map((runtime) => {
              const selected = runtime.id === activeRuntimeId;

              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    "focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                    selected
                      ? "border-emphasis bg-selected"
                      : "border-border hover:border-border-strong",
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
                    <div className="text-fg-3 text-[11px]">{runtime.vendor}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {error !== null ? <div className="text-danger text-[13px]">{error}</div> : null}
      </div>

      <DialogFooter className="border-border-soft border-t px-6 py-4">
        <Button
          onClick={() => {
            onOpenChange(false);
          }}
          type="button"
          variant="outline"
        >
          {t("common.cancel")}
        </Button>
        <Button disabled={!canSubmit} type="submit">
          {createAgentMutation.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("agent.creating")}
            </>
          ) : (
            t("agent.createAction")
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LauncherStatus({ message }: { message: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="text-fg-3 px-7 py-10 text-center text-[13px]">
      <DialogTitle className="sr-only">{t("agent.create")}</DialogTitle>
      {message}
    </div>
  );
}
