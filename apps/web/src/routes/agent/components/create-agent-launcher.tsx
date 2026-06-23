import type { AppId } from "@mosoo/contracts/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { createAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { useVendorCredentialsQuery } from "@/domains/vendor-credential/model/provider-credential-query";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";

import { resolveDefaultAgentRuntime } from "../runtime-default";

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
      <DialogContent
        showCloseButton
        className="gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[420px]"
      >
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
  const createStartedRef = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });

  useEffect(() => {
    if (credentialsLoading || createStartedRef.current) {
      return;
    }

    const runtime = resolveDefaultAgentRuntime(credentials);

    if (runtime === null) {
      setLocalError("Configure a provider before creating agents.");
      return;
    }

    const runtimeConfig = runtime;
    createStartedRef.current = true;

    async function createAndOpenPreview(): Promise<void> {
      try {
        const createdAgent = await createAgentMutation.mutateAsync({
          kind: "pet",
          model: runtimeConfig.model,
          name: DEFAULT_AGENT_NAME,
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

    void createAndOpenPreview();
  }, [appId, createAgentMutation, credentials, credentialsLoading, navigate, onOpenChange]);

  const mutationError =
    createAgentMutation.error instanceof Error ? createAgentMutation.error.message : null;
  const error = localError ?? mutationError;

  return (
    <div className="px-7 py-10 text-center">
      <DialogTitle asChild>
        <h2 className="text-foreground text-[16px] font-medium">Creating agent</h2>
      </DialogTitle>
      {error === null ? (
        <div className="text-muted-foreground mt-3 flex items-center justify-center gap-2 text-[13px]">
          <Loader2 className="size-4 animate-spin" />
          Opening Preview…
        </div>
      ) : (
        <div className="text-destructive mt-3 text-[13px]">{error}</div>
      )}
    </div>
  );
}

function LauncherStatus({ message }: { message: string }): ReactElement {
  return (
    <div className="text-muted-foreground px-7 py-10 text-center text-[13px]">
      <DialogTitle className="sr-only">Create agent</DialogTitle>
      {message}
    </div>
  );
}
