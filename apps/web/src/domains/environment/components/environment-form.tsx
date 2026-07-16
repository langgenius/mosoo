import { isWritableEnvironmentPackageManager } from "@mosoo/contracts/environment";
import { Check, Plus, Trash2 } from "lucide-react";

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
import { createDraftId, createPackageRow, getPackageManagerError } from "./environment-form-model";
import type { EditablePackageRow, EnvironmentDraft } from "./environment-form-model";

function EnvironmentPackagesSection({
  disabled,
  onAdd,
  onRemove,
  onUpdate,
  packageManagerError,
  packages,
}: {
  disabled: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, transform: (row: EditablePackageRow) => EditablePackageRow) => void;
  packageManagerError: string | null;
  packages: EditablePackageRow[];
}) {
  return (
    <EnvironmentFormSection
      action={
        <Button
          aria-label="Add package"
          className="size-8"
          disabled={disabled}
          onClick={onAdd}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Plus className="size-4" />
        </Button>
      }
      description="Public packages with exact versions. npm provides CLIs and CommonJS require; Node ESM imports require a project-local install. PyPI provides Python imports and scripts."
      title="Packages"
    >
      <div className="environment-scroll-area max-h-[220px] space-y-2 overflow-y-auto pr-1">
        {packages.map((row) => (
          <div
            className="environment-row-enter grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_36px]"
            key={row.id}
          >
            <PackageManagerSelect
              disabled={disabled}
              onChange={(manager) => {
                onUpdate(row.id, (current) => ({
                  ...current,
                  manager,
                }));
              }}
              value={row.manager}
            />
            <Input
              aria-label="Package name and version"
              className={cn(
                "font-mono text-[12px]",
                row.packagesText.trim() &&
                  (!row.manager || !isWritableEnvironmentPackageManager(row.manager))
                  ? "border-destructive"
                  : null,
              )}
              disabled={disabled}
              onChange={(event) => {
                onUpdate(row.id, (current) => ({
                  ...current,
                  packagesText: event.target.value,
                }));
              }}
              placeholder={row.manager === "npm" ? "package@1.0.0" : "package==1.0.0"}
              value={row.packagesText}
            />
            <Button
              aria-label="Remove package"
              className="text-fg-3 hover:text-destructive size-9"
              disabled={disabled}
              onClick={() => {
                onRemove(row.id);
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
          <div className="text-destructive text-[11px]">{packageManagerError}</div>
        ) : null}
      </div>
    </EnvironmentFormSection>
  );
}

function EnvironmentVariablesSection({
  disabled,
  envVars,
  onAdd,
  onChange,
  onRemove,
}: {
  disabled: boolean;
  envVars: EnvironmentDraft["envVars"];
  onAdd: () => void;
  onChange: (transform: (current: EnvironmentDraft) => EnvironmentDraft) => void;
  onRemove: (id: string) => void;
}) {
  const envVarCount = envVars.length;

  return (
    <EnvironmentFormSection
      action={
        <Button
          aria-label="Add environment variable"
          className="size-8"
          disabled={disabled}
          onClick={onAdd}
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

        {envVars.map((envVar) => (
          <div
            className="environment-row-enter grid gap-2 sm:grid-cols-[1fr_1fr_36px]"
            key={envVar.id}
          >
            <Input
              aria-label="Variable name"
              className="font-mono text-[12px]"
              disabled={disabled}
              onChange={(event) => {
                onChange((current) => ({
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
              aria-label="Variable value"
              className="font-mono text-[12px]"
              disabled={disabled}
              onChange={(event) => {
                onChange((current) => ({
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
              aria-label="Remove environment variable"
              className="text-fg-3 hover:text-destructive size-9"
              disabled={disabled}
              onClick={() => {
                onRemove(envVar.id);
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
  );
}

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
  const packageManagerError = getPackageManagerError(draft.packages);

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
        description="Save network-policy intent for this Environment. The current Sandbox runtime does not enforce these controls yet."
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
                Allow MCP endpoints (saved only)
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
                Allow package registries (saved only)
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
                <Label>Allowed hosts (saved only)</Label>
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

      <EnvironmentPackagesSection
        disabled={disabled}
        onAdd={addPackageRow}
        onRemove={removePackageRow}
        onUpdate={updatePackageRow}
        packageManagerError={packageManagerError}
        packages={draft.packages}
      />

      <EnvironmentFormSection
        description="Runs after prepared packages are restored in every new Sandbox. Do not install persistent dependencies here."
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

      <EnvironmentVariablesSection
        disabled={disabled}
        envVars={draft.envVars}
        onAdd={addEnvVarRow}
        onChange={update}
        onRemove={removeEnvVarRow}
      />

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
            disabled={disabled || !draft.name.trim() || Boolean(packageManagerError)}
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
