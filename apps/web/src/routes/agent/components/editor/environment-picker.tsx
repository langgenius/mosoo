import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { Box, Check, ExternalLink, Plus, Star } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { CreateEnvironmentDialog } from "@/domains/environment/components/create-environment-dialog";
import { useOrganizationEnvironmentsQuery } from "@/domains/environment/query/environment-queries";
import { cn } from "@/shared/lib/class-names";
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
  return (
    <button
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
        selected ? "bg-ink-100 text-fg-1" : "hover:bg-accent/50",
      )}
      onClick={onSelect}
      type="button"
    >
      <div
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
          selected ? "border-brand bg-brand" : "border-border",
        )}
      >
        {selected ? <Check className="size-3 text-white" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{environment.name}</span>
          {environment.isDefault ? <Star className="size-3 shrink-0" /> : null}
        </div>
        <div className="text-muted-foreground mt-0.5 text-[11px]">
          {describeEnvironment(environment)}
        </div>
      </div>
    </button>
  );
}

export function EnvironmentPicker({
  model,
  organizationId,
  readOnly = false,
}: {
  model: AgentEditorModel;
  organizationId: string | null;
  readOnly?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activeOrganizationId =
    organizationId !== null && organizationId !== "" ? organizationId : null;
  const environmentsQuery = useOrganizationEnvironmentsQuery(activeOrganizationId);
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
      <Label className="text-muted-foreground text-[12px]">Runtime Environment</Label>
      <div className="relative">
        <button
          className={cn(
            "flex min-h-[52px] w-full items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2 text-left transition-colors",
            readOnly ? "cursor-default opacity-80" : "cursor-pointer hover:border-brand/30",
            open ? "border-brand/30 ring-2 ring-brand-ring" : null,
          )}
          disabled={readOnly || activeOrganizationId === null}
          onClick={() => {
            setOpen((current) => !current);
          }}
          type="button"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="bg-secondary flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Box className="text-brand size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-foreground truncate text-[13px] font-semibold">
                  {selectedEnvironmentMissing
                    ? "Loading selected environment..."
                    : (selectedEnvironment?.name ?? "Organization default")}
                </span>
                {selectedEnvironment?.isDefault === true ? (
                  <Star className="text-brand size-3" />
                ) : null}
              </div>
              <div className="text-muted-foreground mt-0.5 text-[11px]">
                {selectedEnvironment
                  ? describeEnvironment(selectedEnvironment)
                  : selectedEnvironmentMissing
                    ? "Refreshing Environment list"
                    : "Resolved when the session starts"}
              </div>
            </div>
          </div>
          {readOnly ? null : <span className="text-muted-foreground">▾</span>}
        </button>

        {open ? (
          <>
            <button
              aria-label="Close environment menu"
              className="fixed inset-0 z-40"
              onClick={() => {
                setOpen(false);
              }}
              type="button"
            />
            <div className="border-border absolute top-full right-0 left-0 z-50 mt-1 rounded-lg border bg-white p-1.5 shadow-lg">
              <div className="max-h-[260px] overflow-y-auto">
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
              <div className="border-border-subtle mt-1 grid gap-1 border-t pt-1">
                <button
                  className="text-brand hover:bg-brand-light/60 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={activeOrganizationId === null}
                  onClick={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                  type="button"
                >
                  <Plus className="size-4" />
                  Create environment
                </button>
                {selectedEnvironment ? (
                  <Link
                    className="text-fg-2 hover:bg-accent/50 hover:text-fg-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors"
                    onClick={() => {
                      setOpen(false);
                    }}
                    to={`/environment/${selectedEnvironment.id}`}
                  >
                    <ExternalLink className="size-4" />
                    Open selected environment
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {activeOrganizationId !== null ? (
        <CreateEnvironmentDialog
          onCreated={(environment) => {
            model.setEnvironmentId(environment.id);
          }}
          onOpenChange={setCreateOpen}
          open={createOpen}
          organizationId={activeOrganizationId}
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
  if (loading) {
    return <div className="text-muted-foreground p-3 text-[12px]">Loading environments…</div>;
  }

  if (error) {
    return (
      <div className="text-destructive p-3 text-[12px]">
        {error instanceof Error ? error.message : "Failed to load environments."}
      </div>
    );
  }

  if (environments.length === 0) {
    return (
      <div className="text-muted-foreground p-3 text-[12px]">No environments are available.</div>
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
