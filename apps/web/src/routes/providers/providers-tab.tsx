import { PUBLIC_VENDORS, getVendor } from "@mosoo/runtime-catalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { useId, useMemo, useState } from "react";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import {
  createVendorCredential,
  deleteVendorCredential,
  listVendorCredentials,
  setDefaultVendorCredential,
  testVendorCredential,
  updateVendorCredential,
} from "@/domains/vendor-credential/api/vendor-credential-client";
import { canUseCustomEndpoint } from "@/domains/vendor-credential/model/provider-credential-endpoint";
import { getErrorMessage } from "@/domains/vendor-credential/model/provider-credential-error";
import { formatProviderErrorMessage } from "@/domains/vendor-credential/model/provider-readiness-copy";
import { toAppId, toVendorCredentialId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

import { ProviderTestStatus } from "./provider-test-status";
import { RuntimeAvailabilitySection } from "./runtime-availability-section";

const CUSTOM_PROVIDER_VENDOR_ID = "openai-compatible";

type TestState = "failure" | "idle" | "running" | "success";

interface CredentialForm {
  apiBase: string;
  apiKey: string;
  id: string | null;
  modelsText: string;
  name: string;
  vendorId: string;
}

const EMPTY_FORM: CredentialForm = {
  apiBase: "",
  apiKey: "",
  id: null,
  modelsText: "",
  name: "",
  vendorId: "",
};

interface ProviderFormControls {
  form: CredentialForm;
  onCancel: () => void;
  onChange: (form: CredentialForm) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testState: TestState;
}

const providerCredentialKeys = {
  list: (appId: string) => ["vendor-credentials", appId] as const,
};

// Preset providers (Anthropic, OpenAI) carry a default endpoint; pre-fill it so
// the user does not have to look it up. OpenAI-compatible has no default.
function defaultApiBaseForVendor(vendorId: string): string {
  return getVendor(vendorId)?.defaultApiBase ?? "";
}

function displayApiBase(credential: VendorCredential): string {
  return credential.apiBase ?? "Provider endpoint";
}

function formModels(form: CredentialForm): string[] | undefined {
  const models = [
    ...new Set(
      form.modelsText
        .split(/\r?\n|,/u)
        .map((modelId) => modelId.trim())
        .filter(Boolean),
    ),
  ];

  return models.length > 0 ? models : undefined;
}

function vendorLabel(vendorId: string): string {
  return PUBLIC_VENDORS.find((vendor) => vendor.vendorId === vendorId)?.label ?? vendorId;
}

function credentialsByVendor(
  credentials: readonly VendorCredential[],
): Map<string, VendorCredential[]> {
  const grouped = new Map<string, VendorCredential[]>();

  for (const credential of credentials) {
    grouped.set(credential.vendorId, [...(grouped.get(credential.vendorId) ?? []), credential]);
  }

  return grouped;
}

export function ProvidersTab({ appId }: { appId: string }): ReactElement {
  const typedAppId = toAppId(appId);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>("idle");
  const credentialsQuery = useQuery({
    queryFn: async () => listVendorCredentials(typedAppId),
    queryKey: providerCredentialKeys.list(appId),
  });
  const credentials = credentialsQuery.data ?? [];
  const groupedCredentials = useMemo(() => credentialsByVendor(credentials), [credentials]);

  const invalidateCredentials = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: providerCredentialKeys.list(appId) });
  };

  const saveMutation = useMutation({
    mutationFn: async (nextForm: CredentialForm) => {
      const name = nextForm.name.trim();
      const apiKey = nextForm.apiKey.trim();
      const apiBase = canUseCustomEndpoint(nextForm.vendorId)
        ? nextForm.apiBase.trim() || null
        : null;
      const models =
        nextForm.vendorId === CUSTOM_PROVIDER_VENDOR_ID ? formModels(nextForm) : undefined;

      if (name.length === 0 || (nextForm.id === null && apiKey.length === 0)) {
        throw new Error(
          nextForm.id === null ? "Name and API key are required." : "Name is required.",
        );
      }

      if (nextForm.vendorId === CUSTOM_PROVIDER_VENDOR_ID && (!models || models.length === 0)) {
        throw new Error("OpenAI-compatible providers require at least one model id.");
      }

      if (nextForm.id === null) {
        return createVendorCredential({
          apiBase,
          apiKey,
          name,
          appId: typedAppId,
          vendorId: nextForm.vendorId,
          ...(models === undefined ? {} : { models }),
        });
      }

      return updateVendorCredential({
        apiBase,
        ...(apiKey.length > 0 ? { apiKey } : {}),
        id: toVendorCredentialId(nextForm.id),
        name,
        appId: typedAppId,
        ...(models === undefined ? {} : { models }),
      });
    },
    onSuccess: async () => {
      setForm(EMPTY_FORM);
      setTestState("idle");
      await invalidateCredentials();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (credential: VendorCredential) =>
      deleteVendorCredential({ id: credential.id, appId: typedAppId }),
    onSuccess: async () => {
      await invalidateCredentials();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (credential: VendorCredential) =>
      setDefaultVendorCredential({ id: credential.id, appId: typedAppId }),
    onSuccess: async () => {
      await invalidateCredentials();
    },
  });

  async function handleSave(): Promise<void> {
    setError(null);
    try {
      await saveMutation.mutateAsync(form);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, "Failed to save provider key."));
    }
  }

  async function handleTest(): Promise<void> {
    const apiKey = form.apiKey.trim();
    const firstModel = formModels(form)?.[0] ?? null;

    if (form.vendorId.length === 0 || apiKey.length === 0) {
      setError("Provider and API key are required before testing.");
      return;
    }

    setTestState("running");
    setError(null);

    try {
      const result = await testVendorCredential({
        apiBase: canUseCustomEndpoint(form.vendorId) ? form.apiBase.trim() || null : null,
        apiKey,
        modelId: firstModel,
        appId: typedAppId,
        vendorId: form.vendorId,
      });
      setTestState(result.ok ? "success" : "failure");
      if (!result.ok && result.errorCode !== null) {
        setError(formatProviderErrorMessage(result.errorCode));
      }
    } catch (caughtError) {
      setTestState("failure");
      setError(formatProviderErrorMessage(getErrorMessage(caughtError, "Connection test failed.")));
    }
  }

  function startCreate(vendorId: string): void {
    setForm({ ...EMPTY_FORM, apiBase: defaultApiBaseForVendor(vendorId), vendorId });
    setError(null);
    setTestState("idle");
  }

  function startEdit(credential: VendorCredential): void {
    setForm({
      apiBase: credential.apiBase ?? "",
      apiKey: "",
      id: credential.id,
      modelsText: credential.models?.join("\n") ?? "",
      name: credential.name,
      vendorId: credential.vendorId,
    });
    setError(null);
    setTestState("idle");
  }

  // Shared add/edit form controls, rendered inline inside whichever vendor card
  // is being edited (form.vendorId), so the form expands in place rather than as
  // a separate card at the top of the list.
  const formControls: ProviderFormControls = {
    form,
    onCancel: () => {
      setForm(EMPTY_FORM);
      setError(null);
      setTestState("idle");
    },
    onChange: (nextForm) => {
      setForm(nextForm);
      setError(null);
      setTestState("idle");
    },
    onSave: () => {
      void handleSave();
    },
    onTest: () => {
      void handleTest();
    },
    saving: saveMutation.isPending,
    testState,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        className="border-border-subtle border-b"
        title="Providers"
        description="Provider keys are stored and resolved inside the active App."
      >
        <Button onClick={() => startCreate(CUSTOM_PROVIDER_VENDOR_ID)} size="sm" variant="outline">
          <Plus className="size-3.5" />
          Add OpenAI-compatible provider
        </Button>
      </PageHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {credentialsQuery.isLoading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-6 text-sm">
              Loading providers…
            </div>
          ) : null}

          {error === null ? null : (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {credentialsQuery.isLoading ? null : (
            <RuntimeAvailabilitySection credentials={credentials} />
          )}

          {PUBLIC_VENDORS.map((vendor) => (
            <ProviderCredentialSection
              credentials={groupedCredentials.get(vendor.vendorId) ?? []}
              formControls={formControls}
              key={vendor.vendorId}
              onCreate={() => startCreate(vendor.vendorId)}
              onDelete={(credential) => {
                void deleteMutation.mutateAsync(credential).catch((caughtError) => {
                  setError(getErrorMessage(caughtError, "Failed to delete provider key."));
                });
              }}
              onEdit={startEdit}
              onSetDefault={(credential) => {
                void setDefaultMutation.mutateAsync(credential).catch((caughtError) => {
                  setError(getErrorMessage(caughtError, "Failed to set default provider key."));
                });
              }}
              vendorId={vendor.vendorId}
            />
          ))}

          <ProviderCredentialSection
            credentials={groupedCredentials.get(CUSTOM_PROVIDER_VENDOR_ID) ?? []}
            formControls={formControls}
            onCreate={() => startCreate(CUSTOM_PROVIDER_VENDOR_ID)}
            onDelete={(credential) => {
              void deleteMutation.mutateAsync(credential).catch((caughtError) => {
                setError(getErrorMessage(caughtError, "Failed to delete provider key."));
              });
            }}
            onEdit={startEdit}
            onSetDefault={(credential) => {
              void setDefaultMutation.mutateAsync(credential).catch((caughtError) => {
                setError(getErrorMessage(caughtError, "Failed to set default provider key."));
              });
            }}
            vendorId={CUSTOM_PROVIDER_VENDOR_ID}
          />
        </div>
      </main>
    </div>
  );
}

function ProviderCredentialForm({
  form,
  onCancel,
  onChange,
  onSave,
  onTest,
  saving,
  testState,
}: {
  form: CredentialForm;
  onCancel: () => void;
  onChange: (form: CredentialForm) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testState: TestState;
}): ReactElement {
  const endpointEnabled = canUseCustomEndpoint(form.vendorId);
  const formId = useId();
  const nameInputId = `${formId}-name`;
  const apiKeyInputId = `${formId}-api-key`;
  const apiBaseInputId = `${formId}-api-base`;
  const modelsInputId = `${formId}-models`;

  return (
    <div className="border-border-soft mt-1 space-y-3 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-fg-1 text-[13px] font-semibold">
          {form.id === null ? "Add" : "Edit"} {vendorLabel(form.vendorId)} key
        </div>
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
      <div className={endpointEnabled ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
        <label className="space-y-1" htmlFor={nameInputId}>
          <div className="text-muted-foreground text-xs font-medium">Name</div>
          <Input
            id={nameInputId}
            placeholder="Production"
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
          />
        </label>
        {endpointEnabled ? (
          <label className="space-y-1" htmlFor={apiBaseInputId}>
            <div className="text-muted-foreground text-xs font-medium">Base URL</div>
            <Input
              id={apiBaseInputId}
              placeholder={defaultApiBaseForVendor(form.vendorId) || "https://api.example.com/v1"}
              value={form.apiBase}
              onChange={(event) => onChange({ ...form, apiBase: event.target.value })}
            />
          </label>
        ) : null}
      </div>
      <label className="block space-y-1" htmlFor={apiKeyInputId}>
        <div className="text-muted-foreground text-xs font-medium">API key</div>
        <Input
          id={apiKeyInputId}
          placeholder={form.id === null ? "sk-..." : "Leave blank to keep current key"}
          type="password"
          value={form.apiKey}
          onChange={(event) => onChange({ ...form, apiKey: event.target.value })}
        />
      </label>
      {form.vendorId === CUSTOM_PROVIDER_VENDOR_ID ? (
        <label className="block space-y-1" htmlFor={modelsInputId}>
          <div className="text-muted-foreground text-xs font-medium">Models</div>
          <Input
            id={modelsInputId}
            placeholder="gpt-4.1, claude-sonnet-4"
            value={form.modelsText}
            onChange={(event) => onChange({ ...form, modelsText: event.target.value })}
          />
        </label>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button disabled={testState === "running"} onClick={onTest} size="sm" variant="outline">
            {testState === "running" ? "Testing..." : "Test"}
          </Button>
          <ProviderTestStatus error={null} state={testState} />
        </div>
        <Button disabled={saving} onClick={onSave} size="sm">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ProviderCredentialSection({
  credentials,
  formControls,
  onCreate,
  onDelete,
  onEdit,
  onSetDefault,
  vendorId,
}: {
  credentials: readonly VendorCredential[];
  formControls: ProviderFormControls;
  onCreate: () => void;
  onDelete: (credential: VendorCredential) => void;
  onEdit: (credential: VendorCredential) => void;
  onSetDefault: (credential: VendorCredential) => void;
  vendorId: string;
}): ReactElement {
  const isFormOpen = formControls.form.vendorId === vendorId;

  return (
    <section className="border-border bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-fg-1 text-[15px] font-semibold">{vendorLabel(vendorId)}</h2>
          <p className="text-muted-foreground text-[12px]">App-level provider keys</p>
        </div>
        {isFormOpen ? null : (
          <Button onClick={onCreate} size="sm" variant="outline">
            <Plus className="size-3.5" />
            Add key
          </Button>
        )}
      </div>
      {credentials.length > 0 ? (
        <div className="space-y-2">
          {credentials.map((credential) => (
            <div
              className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
              key={credential.id}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-fg-1 truncate text-[13px] font-medium">
                    {credential.name}
                  </span>
                  {credential.isDefault ? (
                    <span className="bg-success-bg text-success-fg shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                      Default
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground truncate font-mono text-[12px]">
                  {credential.maskedApiKey}
                  <span className="text-muted-foreground/60 ml-2">
                    {displayApiBase(credential)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {credential.isDefault ? null : (
                  <Button
                    className="text-muted-foreground h-7 px-2 text-[12px]"
                    onClick={() => onSetDefault(credential)}
                    size="sm"
                    variant="ghost"
                  >
                    Set default
                  </Button>
                )}
                <Button onClick={() => onEdit(credential)} size="icon" variant="ghost">
                  <Pencil className="size-4" />
                </Button>
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(credential)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : isFormOpen ? null : (
        <div className="text-muted-foreground/70 rounded-md border border-dashed px-3 py-3 text-[13px]">
          No key configured in this App.
        </div>
      )}
      {isFormOpen ? <ProviderCredentialForm {...formControls} /> : null}
    </section>
  );
}
