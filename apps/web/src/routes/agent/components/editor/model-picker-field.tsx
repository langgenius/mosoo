import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

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
import { Label } from "@/shared/ui/label";

import { listAvailableAgentModels } from "../../../../domains/vendor-credential/api/vendor-credential-client";
import {
  findCurrentModelEntry,
  listLockedVendorLabels,
  listModelPickerEntries,
} from "./model-picker-availability";
import { ModelPickerEmptyItem, ModelPickerItem, ModelProviderLink } from "./model-picker-ui";
import type { AgentEditorModel } from "./use-model";

export function ModelPickerField({
  model,
  appId,
  readOnly,
}: {
  model: AgentEditorModel;
  appId: string;
  readOnly: boolean;
}): ReactElement {
  const runtimeId = model.draft.runtime;
  const currentModelId = model.draft.model === "" ? null : model.draft.model;
  const currentVendorId = model.draft.provider === "" ? null : model.draft.provider;
  const { data: entries = [], isLoading: loading } = useQuery({
    queryFn: async () =>
      listAvailableAgentModels({
        currentModelId,
        currentVendorId,
        appId: toAppId(appId),
        runtimeId,
      }),
    queryKey: ["available-agent-models", appId, runtimeId, currentModelId, currentVendorId],
  });
  const pickerEntries = listModelPickerEntries(entries, currentModelId, currentVendorId);
  const currentEntry = findCurrentModelEntry(entries, currentModelId, currentVendorId);
  const hasAvailable = entries.some((entry) => entry.available);
  const triggerLabel = currentEntry?.displayName ?? "Pick an available model";
  const showInvalidHint = currentEntry?.available === false && currentEntry.reason !== "needs-key";
  const isEmpty = !loading && !hasAvailable;
  const menuIsEmpty = !loading && pickerEntries.length === 0;
  const lockedVendors = listLockedVendorLabels(entries);
  let buttonLabel = triggerLabel;
  if (loading) {
    buttonLabel = "Loading models...";
  } else if (currentEntry === null && isEmpty) {
    buttonLabel = "No models available";
  }

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground text-[12px]">Model</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="w-full justify-between"
            disabled={readOnly || loading || menuIsEmpty}
            type="button"
            variant="outline"
          >
            <span className="text-foreground truncate text-left text-[13px] font-medium">
              {buttonLabel}
            </span>
            <ChevronDown className="text-muted-foreground size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuLabel>Available models</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="max-h-[280px] overflow-y-auto">
            {menuIsEmpty ? <ModelPickerEmptyItem /> : null}
            {pickerEntries.map((entry) => (
              <ModelPickerItem
                entry={entry}
                key={`${entry.vendorId}:${entry.modelId}`}
                onPick={() => {
                  model.setModelSelection({
                    model: entry.modelId,
                    provider: entry.vendorId,
                  });
                }}
                selected={
                  entry.modelId === model.draft.model && entry.vendorId === model.draft.provider
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

      {showInvalidHint && currentEntry !== null ? (
        <p className="text-destructive text-[11px]">
          {currentEntry.statusDetail ?? currentEntry.statusLabel}
        </p>
      ) : null}
    </div>
  );
}
