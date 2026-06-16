import type { Viewer } from "@mosoo/contracts/account";
import { SYSTEM_AGENT_RUNTIME_ID } from "@mosoo/runtime-catalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Zap } from "lucide-react";
import type { ReactElement } from "react";

import { setSystemAgentModel } from "@/domains/user/api/user-client";
import { userKeys, useViewerQuery } from "@/domains/user/query/user-queries";
import { listAvailableAgentModels } from "@/domains/vendor-credential/api/vendor-credential-client";
import { toAppId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  findCurrentModelEntry,
  listLockedVendorLabels,
  listModelPickerEntries,
} from "../editor/model-picker-availability";
import {
  ModelPickerEmptyItem,
  ModelPickerItem,
  ModelProviderLink,
} from "../editor/model-picker-ui";

interface SystemAgentModelSelection {
  readonly modelId: string;
  readonly vendor: string;
}

function sameSelection(
  left: SystemAgentModelSelection | null,
  right: SystemAgentModelSelection,
): boolean {
  return left?.modelId === right.modelId && left.vendor === right.vendor;
}

function updateViewerSystemAgentModel(
  viewer: Viewer | undefined,
  systemAgentModel: SystemAgentModelSelection | null,
): Viewer | undefined {
  if (viewer?.account === null || viewer?.account === undefined) {
    return viewer;
  }

  return {
    ...viewer,
    account: {
      ...viewer.account,
      systemAgentModel,
    },
  };
}

export function AgentBuilderModelPicker({
  appId,
  onError,
}: {
  appId: string;
  onError: (message: string | null) => void;
}): ReactElement {
  const typedAppId = toAppId(appId);
  const queryClient = useQueryClient();
  const viewerQuery = useViewerQuery();
  const currentSelection = viewerQuery.data?.account?.systemAgentModel ?? null;
  const currentModelId = currentSelection?.modelId ?? null;
  const currentVendorId = currentSelection?.vendor ?? null;
  const entriesQuery = useQuery({
    queryFn: async () =>
      listAvailableAgentModels({
        appId: typedAppId,
        currentModelId,
        currentVendorId,
        runtimeId: SYSTEM_AGENT_RUNTIME_ID,
      }),
    queryKey: [
      "available-agent-models",
      appId,
      SYSTEM_AGENT_RUNTIME_ID,
      currentModelId,
      currentVendorId,
    ],
  });
  const mutation = useMutation({
    mutationFn: setSystemAgentModel,
    onError: (error: unknown) => {
      onError(error instanceof Error ? error.message : "Failed to update Builder model.");
    },
    onMutate: () => {
      onError(null);
    },
    onSuccess: (systemAgentModel) => {
      queryClient.setQueryData<Viewer>(userKeys.viewer(), (viewer) =>
        updateViewerSystemAgentModel(viewer, systemAgentModel),
      );
      void queryClient.invalidateQueries({ queryKey: userKeys.viewer() });
    },
  });
  const entries = entriesQuery.data ?? [];
  const pickerEntries = listModelPickerEntries(entries, currentModelId, currentVendorId);
  const currentEntry = findCurrentModelEntry(entries, currentModelId, currentVendorId);
  const hasAvailable = entries.some((entry) => entry.available);
  const lockedVendors = listLockedVendorLabels(entries);
  const loading = entriesQuery.isLoading || viewerQuery.isLoading;
  const disabled = loading || mutation.isPending;
  const triggerLabel =
    loading || mutation.isPending
      ? "Model..."
      : (currentEntry?.displayName ?? (hasAvailable ? "Model" : "No models"));

  function pickModel(selection: SystemAgentModelSelection): void {
    if (sameSelection(currentSelection, selection) || mutation.isPending) {
      return;
    }

    mutation.mutate(selection);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Select Agent Builder model"
          className="text-muted-foreground hover:text-foreground max-w-[180px] gap-1.5 px-2.5"
          disabled={disabled}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Zap className="size-3.5" />
          <span className="truncate text-[12px] font-medium">{triggerLabel}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px]" side="top" sideOffset={8}>
        <DropdownMenuLabel>Builder model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[280px] overflow-y-auto">
          {pickerEntries.length === 0 ? <ModelPickerEmptyItem /> : null}
          {pickerEntries.map((entry) => (
            <ModelPickerItem
              entry={entry}
              key={`${entry.vendorId}:${entry.modelId}`}
              onPick={() => {
                pickModel({
                  modelId: entry.modelId,
                  vendor: entry.vendorId,
                });
              }}
              selected={
                entry.modelId === currentSelection?.modelId &&
                entry.vendorId === currentSelection.vendor
              }
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <ModelProviderLink lockedVendors={lockedVendors} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
