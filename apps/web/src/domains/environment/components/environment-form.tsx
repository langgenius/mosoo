import { Check, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

import { isTruthy } from "../../../shared/lib/truthiness";
import {
  EnvironmentFormSection,
  NetworkPolicySelect,
  PackageManagerSelect,
} from "./environment-form-controls";
import { createDraftId, createPackageRow, hasPackageManagerError } from "./environment-form-model";
import type { EditablePackageRow, EnvironmentDraft } from "./environment-form-model";

export function EnvironmentForm({
  disabled = false,
  draft,
  onCancel,
  onChange,
  onSubmit,
  submitLabel,
}: {
  disabled?: boolean;
  draft: EnvironmentDraft;
  onCancel?: () => void;
  onChange: (nextDraft: EnvironmentDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const limited = draft.networkPolicy === "limited";
  const envVarCount = useMemo(() => draft.envVars.length, [draft.envVars.length]);
  const packageManagerError = hasPackageManagerError(draft.packages);

  function update(transform: (current: EnvironmentDraft) => EnvironmentDraft) {
    onChange(transform(draft));
  }

  function addPackageRow() {
    update((current) => ({
      ...current,
      packages: [...current.packages, createPackageRow()],
    }));
  }

  function updatePackageRow(
    id: string,
    transform: (row: EditablePackageRow) => EditablePackageRow,
  ) {
    update((current) => ({
      ...current,
      packages: current.packages.map((row) => (row.id === id ? transform(row) : row)),
    }));
  }

  function removePackageRow(id: string) {
    update((current) => {
      const nextRows = current.packages.filter((row) => row.id !== id);

      return {
        ...current,
        packages: nextRows.length > 0 ? nextRows : [createPackageRow()],
      };
    });
  }

  function addEnvVarRow() {
    update((current) => ({
      ...current,
      envVars: [
        ...current.envVars,
        { id: createDraftId(), key: "", preview: null, status: "pending", value: "" },
      ],
    }));
  }

  function removeEnvVarRow(id: string) {
    update((current) => ({
      ...current,
      envVars: current.envVars.filter((candidate) => candidate.id !== id),
    }));
  }

  return (
    <div className="space-y-5">
      <EnvironmentFormSection
        description="Name this reusable runtime container template."
        title="Basics"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              disabled={disabled}
              onChange={(event) => {
                update((current) => ({
                  ...current,
                  name: event.target.value,
                }));
              }}
              placeholder="data-sci-locked"
              value={draft.name}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              disabled={disabled}
              onChange={(event) => {
                update((current) => ({
                  ...current,
                  description: event.target.value,
                }));
              }}
              placeholder="Runtime template for analysis agents"
              value={draft.description}
            />
          </div>
        </div>
      </EnvironmentFormSection>

      <EnvironmentFormSection
        description="Configure network access policies for this environment."
        title="Networking"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <NetworkPolicySelect
              disabled={disabled}
              onChange={(networkPolicy) => {
                update((current) => ({
                  ...current,
                  networkPolicy,
                }));
              }}
              value={draft.networkPolicy}
            />
          </div>

          {limited ? (
            <div className="environment-row-enter space-y-3">
              <label
                className="text-fg-1 flex items-center justify-between gap-3 text-[13px] font-medium"
                htmlFor="environment-form-allow-mcp-servers"
              >
                Allow MCP endpoints
                <Switch
                  checked={draft.allowMcpServers}
                  disabled={disabled}
                  id="environment-form-allow-mcp-servers"
                  onCheckedChange={(checked) => {
                    update((current) => ({
                      ...current,
                      allowMcpServers: checked,
                    }));
                  }}
                />
              </label>
              <label
                className="text-fg-1 flex items-center justify-between gap-3 text-[13px] font-medium"
                htmlFor="environment-form-allow-package-registries"
              >
                Allow package registries
                <Switch
                  checked={draft.allowPackageManagers}
                  disabled={disabled}
                  id="environment-form-allow-package-registries"
                  onCheckedChange={(checked) => {
                    update((current) => ({
                      ...current,
                      allowPackageManagers: checked,
                    }));
                  }}
                />
              </label>
              <div className="space-y-1.5">
                <Label>Allowed hosts</Label>
                <Textarea
                  className="min-h-[96px] font-mono text-[12px]"
                  disabled={disabled}
                  onChange={(event) => {
                    update((current) => ({
                      ...current,
                      allowedHostsText: event.target.value,
                    }));
                  }}
                  placeholder="api.githubcopilot.com, mcp.linear.app"
                  value={draft.allowedHostsText}
                />
              </div>
            </div>
          ) : null}
        </div>
      </EnvironmentFormSection>

      <EnvironmentFormSection
        action={
          <Button
            className="size-8"
            disabled={disabled}
            onClick={addPackageRow}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        }
        description="Specify packages and their versions available in this environment. Separate multiple values with spaces."
        title="Packages"
      >
        <div className="environment-scroll-area max-h-[220px] space-y-2 overflow-y-auto pr-1">
          {draft.packages.map((row) => (
            <div
              className="environment-row-enter grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_36px]"
              key={row.id}
            >
              <PackageManagerSelect
                disabled={disabled}
                onChange={(manager) => {
                  updatePackageRow(row.id, (current) => ({
                    ...current,
                    manager,
                  }));
                }}
                value={row.manager}
              />
              <Input
                className={cn(
                  "font-mono text-[12px]",
                  row.packagesText.trim() && !row.manager ? "border-destructive" : null,
                )}
                disabled={disabled}
                onChange={(event) => {
                  updatePackageRow(row.id, (current) => ({
                    ...current,
                    packagesText: event.target.value,
                  }));
                }}
                placeholder="package package==1.0.0"
                value={row.packagesText}
              />
              <Button
                className="text-fg-3 hover:text-destructive size-9"
                disabled={disabled}
                onClick={() => {
                  removePackageRow(row.id);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          {packageManagerError ? (
            <div className="text-destructive text-[11px]">
              Choose a package manager for every package row.
            </div>
          ) : null}
        </div>
      </EnvironmentFormSection>

      <EnvironmentFormSection
        description="Run after package installation before a session starts."
        title="Setup script"
      >
        <Textarea
          className="min-h-[110px] font-mono text-[12px]"
          disabled={disabled}
          onChange={(event) => {
            update((current) => ({
              ...current,
              setupScript: event.target.value,
            }));
          }}
          placeholder='echo "ready"'
          value={draft.setupScript}
        />
      </EnvironmentFormSection>

      <EnvironmentFormSection
        action={
          <Button
            className="size-8"
            disabled={disabled}
            onClick={addEnvVarRow}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        }
        description="Values are encrypted after save. Existing values can stay blank."
        title="Environment variables"
      >
        <div className="environment-scroll-area max-h-[220px] space-y-2 overflow-y-auto pr-1">
          {envVarCount === 0 ? (
            <div className="border-border text-fg-3 rounded-md border border-dashed p-3 text-[12px]">
              No environment variables.
            </div>
          ) : null}

          {draft.envVars.map((envVar) => (
            <div
              className="environment-row-enter grid gap-2 sm:grid-cols-[1fr_1fr_36px]"
              key={envVar.id}
            >
              <Input
                className="font-mono text-[12px]"
                disabled={disabled}
                onChange={(event) => {
                  update((current) => ({
                    ...current,
                    envVars: current.envVars.map((candidate) =>
                      candidate.id === envVar.id
                        ? { ...candidate, key: event.target.value }
                        : candidate,
                    ),
                  }));
                }}
                placeholder="SLACK_TOKEN"
                value={envVar.key}
              />
              <Input
                className="font-mono text-[12px]"
                disabled={disabled}
                onChange={(event) => {
                  update((current) => ({
                    ...current,
                    envVars: current.envVars.map((candidate) =>
                      candidate.id === envVar.id
                        ? { ...candidate, value: event.target.value }
                        : candidate,
                    ),
                  }));
                }}
                placeholder={
                  envVar.status === "pending"
                    ? "pending value"
                    : isTruthy(envVar.preview)
                      ? `Keep ${envVar.preview}`
                      : "value"
                }
                type="password"
                value={envVar.value}
              />
              <Button
                className="text-fg-3 hover:text-destructive size-9"
                disabled={disabled}
                onClick={() => {
                  removeEnvVarRow(envVar.id);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </EnvironmentFormSection>

      <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-fg-3 flex items-center gap-2 text-[12px]">
          <Check className="size-3.5" />
          Save creates a new revision; in-flight sessions are unaffected.
        </div>
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button disabled={disabled} onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          ) : null}
          <Button
            disabled={disabled || !draft.name.trim() || packageManagerError}
            onClick={onSubmit}
            type="button"
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
