import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import { toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
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
  projectId,
  readOnly,
}: {
  model: AgentEditorModel;
  projectId: string;
  readOnly: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const runtimeId = model.draft.runtime;
  const currentModelId = model.draft.model === "" ? null : model.draft.model;
  const currentVendorId = model.draft.provider === "" ? null : model.draft.provider;
  const { data: entries = [], isLoading: loading } = useQuery({
    queryFn: async () =>
      listAvailableAgentModels({
        currentModelId,
        currentVendorId,
        projectId: toProjectId(projectId),
        runtimeId,
      }),
    queryKey: ["available-agent-models", projectId, runtimeId, currentModelId, currentVendorId],
  });
  const pickerEntries = listModelPickerEntries(entries, currentModelId, currentVendorId);
  const currentEntry = findCurrentModelEntry(entries, currentModelId, currentVendorId);
  const hasAvailable = entries.some((entry) => entry.available);
  const triggerLabel = currentEntry?.displayName ?? t("agentEditor.pickAvailableModel");
  const showInvalidHint = currentEntry?.available === false && currentEntry.reason !== "needs-key";
  const isEmpty = !loading && !hasAvailable;
  const menuIsEmpty = !loading && pickerEntries.length === 0;
  const lockedVendors = listLockedVendorLabels(entries);
  let buttonLabel = triggerLabel;
  if (loading) {
    buttonLabel = t("agentEditor.loadingModels");
  } else if (currentEntry === null && isEmpty) {
    buttonLabel = t("agentEditor.noModelsAvailable");
  }

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground text-[12px]">{t("agent.model")}</Label>
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
        <DropdownMenuContent align="start" className="w-[var(--anchor-width)]">
          <DropdownMenuLabel>{t("agent.availableModels")}</DropdownMenuLabel>
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
