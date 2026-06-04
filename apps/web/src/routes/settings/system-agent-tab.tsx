import { SYSTEM_AGENT_RUNTIME_ID } from "@mosoo/runtime-catalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { setSystemAgentModel } from "../../domains/user/api/user-client";
import { useViewerQuery, userKeys } from "../../domains/user/query/user-queries";
import { listAvailableAgentModels } from "../../domains/vendor-credential/api/vendor-credential-client";
import type { ResolvedModelEntry } from "../../domains/vendor-credential/api/vendor-credential-client";
import { listLockedVendorLabels } from "../agent/components/editor/model-picker-availability";
import { ModelPickerItem } from "../agent/components/editor/model-picker-ui";

type SavedState = "idle" | "saving" | "saved" | "error";

export function SystemAgentTab() {
  const viewerQuery = useViewerQuery();
  const queryClient = useQueryClient();
  const [savedState, setSavedState] = useState<SavedState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const systemAgentSetting = viewerQuery.data?.account?.systemAgentModel ?? null;
  const initialModelId = systemAgentSetting?.modelId ?? null;
  const initialVendorId = systemAgentSetting?.vendor ?? null;

  const entriesQuery = useQuery({
    queryFn: async () =>
      listAvailableAgentModels({
        currentModelId: initialModelId,
        currentVendorId: initialVendorId,
        runtimeId: SYSTEM_AGENT_RUNTIME_ID,
      }),
    queryKey: ["available-agent-models", SYSTEM_AGENT_RUNTIME_ID, initialModelId, initialVendorId],
  });

  const setModelMutation = useMutation({
    mutationFn: setSystemAgentModel,
    onError: (error: unknown) => {
      setSavedState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to save.");
    },
    onMutate: () => {
      setSavedState("saving");
      setErrorMessage(null);
    },
    onSuccess: async () => {
      setSavedState("saved");
      setTimeout(() => {
        setSavedState("idle");
      }, 1600);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: userKeys.viewer() }),
        queryClient.invalidateQueries({
          queryKey: ["available-agent-models", SYSTEM_AGENT_RUNTIME_ID],
        }),
      ]);
    },
  });

  const entries = entriesQuery.data ?? [];
  const loading = entriesQuery.isLoading;
  const currentEntry = entries.find(
    (entry) => entry.modelId === initialModelId && entry.vendorId === initialVendorId,
  );
  const triggerLabel =
    currentEntry?.displayName ?? initialModelId ?? "Pick a model for Agent Builder";
  const isEmpty = !loading && entries.length === 0;
  const hasAvailable = entries.some((entry) => entry.available);
  const lockedVendors = listLockedVendorLabels(entries);
  const quickNavLabel =
    lockedVendors.length > 0
      ? `Unlock ${lockedVendors.join(", ")} models in Providers`
      : "Manage Providers";
  const showInvalidHint = currentEntry !== undefined && !currentEntry.available;

  function handlePick(entry: ResolvedModelEntry) {
    if (!entry.available) {
      return;
    }
    if (entry.modelId === initialModelId && entry.vendorId === initialVendorId) {
      return;
    }
    setModelMutation.mutate({ modelId: entry.modelId, vendor: entry.vendorId });
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">Agent Builder</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] p-6">
          <div className="mb-6">
            <p className="text-muted-foreground text-[13px]">
              Agent Builder helps turn your ideas into Agent drafts: prompts, model choices, tools,
              and setup suggestions. Pick the model it should use while helping you build or edit
              Agents. This is your personal preference; other members are unaffected.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-muted-foreground text-[12px] font-medium">Model</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="w-full justify-between"
                  disabled={loading || isEmpty}
                  type="button"
                  variant="outline"
                >
                  <span className="text-foreground truncate text-left text-[13px] font-medium">
                    {loading
                      ? "Loading models..."
                      : isEmpty
                        ? "No models available. Configure a Provider key"
                        : triggerLabel}
                  </span>
                  <ChevronDown className="text-muted-foreground size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                <DropdownMenuLabel>Available models for Agent Builder</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isEmpty ? (
                  <div className="text-muted-foreground px-3 py-6 text-center text-[12px]">
                    No matching models. Configure a Provider key to unlock.
                  </div>
                ) : null}
                {entries.map((entry) => (
                  <ModelPickerItem
                    entry={entry}
                    key={`${entry.vendorId}:${entry.modelId}`}
                    onPick={() => {
                      handlePick(entry);
                    }}
                    selected={
                      entry.modelId === initialModelId && entry.vendorId === initialVendorId
                    }
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center justify-between gap-3">
              {hasAvailable ? (
                <Link
                  className="text-primary inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
                  to="/providers"
                >
                  {quickNavLabel}
                  <ExternalLink className="size-3" />
                </Link>
              ) : (
                <span />
              )}

              <SaveIndicator state={savedState} message={errorMessage} />
            </div>

            {showInvalidHint ? (
              <p className="text-destructive text-[11px]">
                Currently selected model is Not Available; choose another.
              </p>
            ) : null}

            {isEmpty ? (
              <div className="border-amber/30 bg-amber-bg/60 mt-3 flex items-start justify-between gap-3 rounded-md border border-dashed px-3 py-2.5">
                <div className="space-y-0.5">
                  <div className="text-amber-fg text-[12px] font-medium">
                    No models available for Agent Builder
                  </div>
                  <div className="text-amber-fg/80 text-[11px]">
                    Configure at least one Provider key (or add an OpenAI-Compatible Provider).
                  </div>
                </div>
                <Button asChild size="xs" variant="outline">
                  <Link to="/providers">
                    Open Providers
                    <ExternalLink className="size-3" />
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function SaveIndicator({ state, message }: { state: SavedState; message: string | null }) {
  if (state === "saving") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
        <Loader2 className="size-3 animate-spin" />
        Saving&hellip;
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="text-destructive inline-flex items-center gap-1 text-[11px]">
        {message ?? "Failed to save."}
      </span>
    );
  }
  return <span />;
}
