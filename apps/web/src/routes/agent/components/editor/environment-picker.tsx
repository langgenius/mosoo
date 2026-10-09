import { Popover } from "@base-ui/react/popover";
import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { CreateEnvironmentDialog } from "@/domains/environment/components/create-environment-dialog";
import { useProjectEnvironmentsQuery } from "@/domains/environment/query/environment-queries";
import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Box, Check, ExternalLink, Plus, Star } from "@/shared/ui/icons";
import { Label } from "@/shared/ui/label";

import { describeEnvironment } from "./environment-summary";
import type { AgentEditorModel } from "./use-model";

function EnvironmentOption({
  environment,
  selected,
  onSelect,
}: {
  environment: EnvironmentSummary;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <button
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
        selected ? "bg-selected text-fg-1" : "hover:bg-hover/50",
      )}
      onClick={onSelect}
      type="button"
    >
      <div
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
          selected ? "border-emphasis bg-emphasis" : "border-border",
        )}
      >
        {selected ? <Check className="text-emphasis-foreground size-3" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{environment.name}</span>
          {environment.isDefault ? <Star className="size-3 shrink-0" /> : null}
        </div>
        <div className="text-fg-3 mt-0.5 text-[11px]">{describeEnvironment(environment, t)}</div>
      </div>
    </button>
  );
}

export function EnvironmentPicker({
  model,
  projectId,
}: {
  model: AgentEditorModel;
  projectId: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activeProjectId = projectId !== null && projectId !== "" ? projectId : null;
  const environmentsQuery = useProjectEnvironmentsQuery(activeProjectId);
  const environments = environmentsQuery.data ?? [];
  const explicitEnvironmentId =
    model.draft.environmentId !== null && model.draft.environmentId !== ""
      ? model.draft.environmentId
      : null;
  const selectedEnvironment =
    explicitEnvironmentId === null
      ? (environments.find((environment) => environment.isDefault) ?? null)
      : (environments.find((environment) => environment.id === explicitEnvironmentId) ?? null);
  const selectedEnvironmentMissing = explicitEnvironmentId !== null && selectedEnvironment === null;

  return (
    <div className="space-y-2">
      <Label className="text-fg-3 text-[12px]">{t("agentEditor.runtimeEnvironment")}</Label>
      <Popover.Root modal={false} onOpenChange={setOpen} open={open}>
        <Popover.Trigger
          className={cn(
            "flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-border-strong",
            open ? "border-ring" : null,
          )}
          disabled={activeProjectId === null}
          type="button"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="bg-paper-200 flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Box className="text-fg-2 size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-foreground truncate text-[13px] font-semibold">
                  {selectedEnvironmentMissing
                    ? t("agentEditor.loadingSelectedEnvironment")
                    : (selectedEnvironment?.name ?? t("agentEditor.projectDefault"))}
                </span>
                {selectedEnvironment?.isDefault === true ? (
                  <Star className="text-brand size-3" />
                ) : null}
              </div>
              <div className="text-fg-3 mt-0.5 text-[11px]">
                {selectedEnvironment
                  ? describeEnvironment(selectedEnvironment, t)
                  : selectedEnvironmentMissing
                    ? t("agentEditor.refreshingEnvironmentList")
                    : t("agentEditor.resolvedWhenSessionStarts")}
              </div>
            </div>
          </div>
          <span className="text-fg-3">▾</span>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Positioner align="start" className="z-50 w-[var(--anchor-width)]" sideOffset={4}>
            <Popover.Popup className="border-border bg-card flex max-h-[var(--available-height)] flex-col overflow-hidden rounded-lg border p-1.5 shadow-lg outline-none">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <EnvironmentMenuContent
                  environments={environments}
                  error={environmentsQuery.error}
                  loading={environmentsQuery.isLoading}
                  onSelect={(environmentId) => {
                    model.setEnvironmentId(environmentId);
                    setOpen(false);
                  }}
                  selectedEnvironment={selectedEnvironment}
                />
              </div>
              <div className="border-border-soft mt-1 grid shrink-0 gap-1 border-t pt-1">
                <button
                  className="text-fg-1 hover:bg-selected/60 disabled:text-fg-muted flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors disabled:cursor-not-allowed"
                  disabled={activeProjectId === null}
                  onClick={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                  type="button"
                >
                  <Plus className="size-4" />
                  {t("environments.create")}
                </button>
                {selectedEnvironment ? (
                  <Link
                    className="text-fg-2 hover:bg-hover/50 hover:text-fg-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors"
                    onClick={() => {
                      setOpen(false);
                    }}
                    to={`/environment/${selectedEnvironment.id}`}
                  >
                    <ExternalLink className="size-4" />
                    {t("agentEditor.openSelectedEnvironment")}
                  </Link>
                ) : null}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {activeProjectId !== null ? (
        <CreateEnvironmentDialog
          onCreated={(environment) => {
            model.setEnvironmentId(environment.id);
          }}
          onOpenChange={setCreateOpen}
          open={createOpen}
          projectId={activeProjectId}
        />
      ) : null}
    </div>
  );
}

function EnvironmentMenuContent({
  environments,
  error,
  loading,
  onSelect,
  selectedEnvironment,
}: {
  environments: EnvironmentSummary[];
  error: unknown;
  loading: boolean;
  onSelect(environmentId: string): void;
  selectedEnvironment: EnvironmentSummary | null;
}): ReactElement {
  const { t } = useTranslation();

  if (loading) {
    return <div className="text-fg-3 p-3 text-[12px]">{t("agentEditor.loadingEnvironments")}</div>;
  }

  if (error) {
    return (
      <div className="text-danger p-3 text-[12px]">
        {error instanceof Error ? error.message : t("agentEditor.failedToLoadEnvironments")}
      </div>
    );
  }

  if (environments.length === 0) {
    return (
      <div className="text-fg-3 p-3 text-[12px]">{t("agentEditor.noEnvironmentsAvailable")}</div>
    );
  }

  return (
    <>
      {environments.map((environment) => (
        <EnvironmentOption
          environment={environment}
          key={environment.id}
          onSelect={() => {
            onSelect(environment.id);
          }}
          selected={selectedEnvironment !== null && environment.id === selectedEnvironment.id}
        />
      ))}
    </>
  );
}
