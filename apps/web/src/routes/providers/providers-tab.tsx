import type { ProjectId, VendorCredentialId } from "@mosoo/id";
import { PUBLIC_VENDORS, getVendor } from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useId, useMemo, useState } from "react";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import {
  createVendorCredential,
  deleteVendorCredential,
  setDefaultVendorCredential,
  testVendorCredential,
  updateVendorCredential,
} from "@/domains/vendor-credential/api/vendor-credential-client";
import { canUseCustomEndpoint } from "@/domains/vendor-credential/model/provider-credential-endpoint";
import {
  useVendorCredentialsQuery,
  vendorCredentialKeys,
} from "@/domains/vendor-credential/model/provider-credential-query";
import {
  CUSTOM_MODEL_PROTOCOL_OPTIONS,
  modelProtocolLabel,
} from "@/domains/vendor-credential/model/provider-model-protocol";
import { formatProviderErrorMessage } from "@/domains/vendor-credential/model/provider-readiness-copy";
import { useTranslation } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";
import { VendorIcon, hasVendorIcon } from "@/shared/ui/brand-icons";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Check, Pencil, Plus, Trash2 } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { ConnectionRow } from "@/shared/ui/list-row";
import { MonoText } from "@/shared/ui/mono-text";
import { PageHeader } from "@/shared/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

import { RuntimeAvailabilitySection } from "./runtime-availability-section";

const CUSTOM_PROVIDER_VENDOR_ID = "openai-compatible";
const CUSTOM_PROVIDER_DISPLAY: Pick<RuntimeCatalogVendor, "iconKey" | "label" | "vendorId"> = {
  iconKey: "openai",
  label: "providers.customProvider",
  vendorId: CUSTOM_PROVIDER_VENDOR_ID,
};

type TestState = "failure" | "idle" | "running" | "success";

interface CredentialForm {
  apiBase: string;
  apiKey: string;
  id: VendorCredentialId | null;
  maskedApiKey: string | null;
  modelProtocol: PresetModelProtocol | null;
  modelsText: string;
  name: string;
  vendorId: string;
}

const EMPTY_FORM: CredentialForm = {
  apiBase: "",
  apiKey: "",
  id: null,
  maskedApiKey: null,
  modelProtocol: null,
  modelsText: "",
  name: "",
  vendorId: "",
};

interface ProviderFormControls {
  error: string | null;
  form: CredentialForm;
  onCancel: () => void;
  onChange: (form: CredentialForm) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testState: TestState;
}

// Preset providers can carry a default endpoint; pre-fill it so the user does
// not have to look it up. OpenAI-compatible has no default.
function defaultApiBaseForVendor(vendorId: string): string {
  return getVendor(vendorId)?.defaultApiBase ?? "";
}

function displayApiBase(
  credential: VendorCredential,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return credential.apiBase ?? t("providers.providerEndpoint");
}

function formModels(form: CredentialForm): string[] | undefined {
  const models = [
    ...new Set(
      form.modelsText.split(/\r?\n|,/u).flatMap((modelId) => {
        const trimmed = modelId.trim();
        return trimmed ? [trimmed] : [];
      }),
    ),
  ];

  return models.length > 0 ? models : undefined;
}

function vendorLabel(vendorId: string): string {
  if (vendorId === CUSTOM_PROVIDER_VENDOR_ID) {
    return "providers.customProvider";
  }

  return PUBLIC_VENDORS.find((vendor) => vendor.vendorId === vendorId)?.label ?? vendorId;
}

function apiKeyPlaceholder(
  form: CredentialForm,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (form.id === null) {
    return "sk-...";
  }

  return form.maskedApiKey
    ? t("providers.currentKey", { key: form.maskedApiKey })
    : t("providers.currentKeySaved");
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

export function ProvidersTab({ projectId }: { projectId: ProjectId }): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>("idle");
  const { credentials, loading: credentialsLoading } = useVendorCredentialsQuery(projectId);
  const groupedCredentials = useMemo(() => credentialsByVendor(credentials), [credentials]);

  async function invalidateProviderQueries(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: vendorCredentialKeys.list(projectId) }),
      queryClient.invalidateQueries({ queryKey: ["available-agent-models", projectId] }),
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: async (nextForm: CredentialForm) => {
      const name = nextForm.name.trim();
      const apiKey = nextForm.apiKey.trim();
      const apiBase = canUseCustomEndpoint(nextForm.vendorId)
        ? nextForm.apiBase.trim() || null
        : null;
      const models =
        nextForm.vendorId === CUSTOM_PROVIDER_VENDOR_ID ? formModels(nextForm) : undefined;
      const protocolInput =
        nextForm.vendorId === CUSTOM_PROVIDER_VENDOR_ID
          ? { modelProtocol: nextForm.modelProtocol }
          : {};

      if (name.length === 0 || (nextForm.id === null && apiKey.length === 0)) {
        throw new Error(
          t(nextForm.id === null ? "providers.nameAndApiKeyRequired" : "providers.nameRequired"),
        );
      }

      if (nextForm.vendorId === CUSTOM_PROVIDER_VENDOR_ID && (!models || models.length === 0)) {
        throw new Error(t("providers.modelsRequired"));
      }

      if (nextForm.id === null) {
        return createVendorCredential({
          ...protocolInput,
          apiBase,
          apiKey,
          name,
          projectId,
          vendorId: nextForm.vendorId,
          ...(models === undefined ? {} : { models }),
        });
      }

      return updateVendorCredential({
        ...protocolInput,
        apiBase,
        ...(apiKey.length > 0 ? { apiKey } : {}),
        id: nextForm.id,
        name,
        projectId,
        ...(models === undefined ? {} : { models }),
      });
    },
    onSuccess: async () => {
      setForm(EMPTY_FORM);
      setFormError(null);
      setTestState("idle");
      await invalidateProviderQueries();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (credential: VendorCredential) =>
      deleteVendorCredential({ id: credential.id, projectId }),
    onSuccess: async () => {
      await invalidateProviderQueries();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (credential: VendorCredential) =>
      setDefaultVendorCredential({ id: credential.id, projectId }),
    onSuccess: async () => {
      await invalidateProviderQueries();
    },
  });

  async function handleSave(): Promise<void> {
    setFormError(null);
    try {
      await saveMutation.mutateAsync(form);
    } catch (caughtError) {
      setFormError(
        caughtError instanceof Error ? caughtError.message : t("providers.failedToSaveProviderKey"),
      );
    }
  }

  async function handleTest(): Promise<void> {
    const apiKey = form.apiKey.trim();
    const firstModel = formModels(form)?.[0] ?? null;

    if (form.vendorId.length === 0 || apiKey.length === 0) {
      setFormError(t("providers.providerAndApiKeyRequired"));
      return;
    }

    setTestState("running");
    setFormError(null);

    try {
      const result = await testVendorCredential({
        apiBase: canUseCustomEndpoint(form.vendorId) ? form.apiBase.trim() || null : null,
        apiKey,
        modelId: firstModel,
        ...(form.vendorId === CUSTOM_PROVIDER_VENDOR_ID
          ? { modelProtocol: form.modelProtocol }
          : {}),
        projectId,
        vendorId: form.vendorId,
      });
      setTestState(result.ok ? "success" : "failure");
      if (!result.ok && result.errorCode !== null) {
        setFormError(formatProviderErrorMessage(result.errorCode, t));
      }
    } catch (caughtError) {
      setTestState("failure");
      setFormError(
        formatProviderErrorMessage(
          caughtError instanceof Error ? caughtError.message : t("providers.connectionTestFailed"),
          t,
        ),
      );
    }
  }

  function startCreate(vendorId: string): void {
    setForm({
      ...EMPTY_FORM,
      apiBase: defaultApiBaseForVendor(vendorId),
      modelProtocol: vendorId === CUSTOM_PROVIDER_VENDOR_ID ? "openai-chat-completions" : null,
      vendorId,
    });
    setFormError(null);
    setTestState("idle");
  }

  function startEdit(credential: VendorCredential): void {
    setForm({
      apiBase: credential.apiBase ?? "",
      apiKey: "",
      id: credential.id,
      maskedApiKey: credential.maskedApiKey,
      modelProtocol: credential.modelProtocol,
      modelsText: credential.models?.join("\n") ?? "",
      name: credential.name,
      vendorId: credential.vendorId,
    });
    setFormError(null);
    setTestState("idle");
  }

  function closeFormDialog(): void {
    setForm(EMPTY_FORM);
    setFormError(null);
    setTestState("idle");
  }

  function handleDelete(credential: VendorCredential): void {
    void deleteMutation.mutateAsync(credential).catch((caughtError) => {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : t("providers.failedToDeleteProviderKey"),
      );
    });
  }

  function handleSetDefault(credential: VendorCredential): void {
    void setDefaultMutation.mutateAsync(credential).catch((caughtError) => {
      setPageError(
        caughtError instanceof Error
          ? caughtError.message
          : t("providers.failedToSetDefaultProviderKey"),
      );
    });
  }

  const formControls: ProviderFormControls = {
    error: formError,
    form,
    onCancel: closeFormDialog,
    onChange: (nextForm) => {
      setForm(nextForm);
      setFormError(null);
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
  const formDialogOpen = form.vendorId.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        className="border-border-soft border-b"
        title={t("providers.title")}
        description={t("providers.description")}
      >
        <Button onClick={() => startCreate(CUSTOM_PROVIDER_VENDOR_ID)} variant="outline">
          <Plus className="size-3.5" />
          {t("providers.addCustomProvider")}
        </Button>
      </PageHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-4xl space-y-6">
          {credentialsLoading ? (
            <div className="border-border bg-card text-fg-3 rounded-lg border p-6 text-[13px]">
              {t("providers.loading")}
            </div>
          ) : null}

          {pageError === null ? null : (
            <div
              className="border-danger/30 bg-danger-bg text-danger-fg rounded-md border px-3 py-2 text-[13px]"
              role="alert"
            >
              {pageError}
            </div>
          )}

          {credentialsLoading ? null : <RuntimeAvailabilitySection credentials={credentials} />}

          {PUBLIC_VENDORS.map((vendor) => (
            <ProviderCredentialSection
              credentials={groupedCredentials.get(vendor.vendorId) ?? []}
              key={vendor.vendorId}
              onCreate={() => startCreate(vendor.vendorId)}
              onDelete={handleDelete}
              onEdit={startEdit}
              onSetDefault={handleSetDefault}
              vendor={vendor}
            />
          ))}

          {(groupedCredentials.get(CUSTOM_PROVIDER_VENDOR_ID)?.length ?? 0) > 0 ? (
            <ProviderCredentialSection
              credentials={groupedCredentials.get(CUSTOM_PROVIDER_VENDOR_ID) ?? []}
              onCreate={() => startCreate(CUSTOM_PROVIDER_VENDOR_ID)}
              onDelete={handleDelete}
              onEdit={startEdit}
              onSetDefault={handleSetDefault}
              vendor={CUSTOM_PROVIDER_DISPLAY}
            />
          ) : null}
        </div>
      </main>

      <Dialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeFormDialog();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          {formDialogOpen ? <ProviderCredentialDialogForm {...formControls} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderCredentialDialogForm({
  error,
  form,
  onCancel,
  onChange,
  onSave,
  onTest,
  saving,
  testState,
}: ProviderFormControls): ReactElement {
  const { t } = useTranslation();
  const endpointEnabled = canUseCustomEndpoint(form.vendorId);
  const formId = useId();
  const nameInputId = `${formId}-name`;
  const apiKeyInputId = `${formId}-api-key`;
  const apiBaseInputId = `${formId}-api-base`;
  const modelsInputId = `${formId}-models`;
  const modelProtocolInputId = `${formId}-model-protocol`;
  const modelProtocolHelpId = `${formId}-model-protocol-help`;
  const isCustomProvider = form.vendorId === CUSTOM_PROVIDER_VENDOR_ID;
  const protocolUnspecified = isCustomProvider && form.modelProtocol === null;
  const protocolItems = [
    ...(protocolUnspecified ? [{ label: t("providers.protocolUnspecified"), value: "" }] : []),
    ...CUSTOM_MODEL_PROTOCOL_OPTIONS,
  ];
  const vendorName = t(vendorLabel(form.vendorId));
  // Invalid decoration appears only after a failed save; it never replaces the
  // focus ring (contract section 4, field recipe).
  const showInvalid = error !== null;
  const nameInvalid = showInvalid && form.name.trim().length === 0;
  const apiKeyInvalid = showInvalid && form.id === null && form.apiKey.trim().length === 0;
  const modelsInvalid =
    showInvalid && form.vendorId === CUSTOM_PROVIDER_VENDOR_ID && formModels(form) === undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {form.id === null
            ? t("providers.addKeyTitle", { vendor: vendorName })
            : t("providers.editKeyTitle", { vendor: vendorName })}
        </DialogTitle>
        <DialogDescription>{t("providers.storeCredential")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className={endpointEnabled ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
          <div className="space-y-1.5">
            <Label htmlFor={nameInputId}>{t("providers.name")}</Label>
            <Input
              aria-invalid={nameInvalid || undefined}
              id={nameInputId}
              placeholder={t("providers.productionPlaceholder")}
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
            />
          </div>
          {endpointEnabled ? (
            <div className="space-y-1.5">
              <Label htmlFor={apiBaseInputId}>{t("providers.baseUrl")}</Label>
              <Input
                id={apiBaseInputId}
                placeholder={defaultApiBaseForVendor(form.vendorId) || "https://api.example.com/v1"}
                value={form.apiBase}
                onChange={(event) => onChange({ ...form, apiBase: event.target.value })}
              />
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={apiKeyInputId}>{t("providers.apiKey")}</Label>
          <Input
            aria-invalid={apiKeyInvalid || undefined}
            autoComplete="new-password"
            data-1p-ignore="true"
            id={apiKeyInputId}
            name={`${apiKeyInputId}-provider-secret`}
            placeholder={apiKeyPlaceholder(form, t)}
            type="password"
            value={form.apiKey}
            onChange={(event) => onChange({ ...form, apiKey: event.target.value })}
          />
        </div>
        {form.vendorId === CUSTOM_PROVIDER_VENDOR_ID ? (
          <div className="space-y-1.5">
            <Label htmlFor={modelProtocolInputId}>{t("providers.modelProtocol")}</Label>
            <Select
              items={protocolItems}
              onValueChange={(value) => {
                const protocol = CUSTOM_MODEL_PROTOCOL_OPTIONS.find(
                  (option) => option.value === value,
                );
                if (protocol !== undefined) {
                  onChange({ ...form, modelProtocol: protocol.value });
                }
              }}
              value={form.modelProtocol ?? ""}
            >
              <SelectTrigger
                aria-describedby={modelProtocolHelpId}
                className="w-full"
                id={modelProtocolInputId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {protocolItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-fg-3 text-[12px] leading-4" id={modelProtocolHelpId}>
              {t(protocolUnspecified ? "providers.protocolLegacyHelp" : "providers.protocolHelp")}
            </p>
          </div>
        ) : null}
        {form.vendorId === CUSTOM_PROVIDER_VENDOR_ID ? (
          <div className="space-y-1.5">
            <Label htmlFor={modelsInputId}>{t("providers.models")}</Label>
            <Input
              aria-invalid={modelsInvalid || undefined}
              id={modelsInputId}
              placeholder="gpt-4.1, claude-sonnet-4"
              value={form.modelsText}
              onChange={(event) => onChange({ ...form, modelsText: event.target.value })}
            />
          </div>
        ) : null}
        {error === null ? null : (
          <div
            className="border-danger/30 bg-danger-bg text-danger-fg rounded-md border px-3 py-2 text-[13px]"
            role="alert"
          >
            {error}
          </div>
        )}
      </div>
      <DialogFooter>
        <div className="flex flex-1 items-center gap-2">
          <Button onClick={onCancel} variant="ghost">
            {t("common.cancel")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-busy={testState === "running" || undefined}
            disabled={testState === "running" || protocolUnspecified}
            onClick={onTest}
            variant="outline"
          >
            {testState === "running" ? t("providers.testing") : t("providers.test")}
          </Button>
          {/* Failures surface in the form-level alert, so only success shows here. */}
          {testState === "success" ? (
            <span className="text-success-fg inline-flex items-center gap-1 text-[12px] font-medium">
              <Check className="size-3.5 shrink-0" />
              {t("providers.connectionOk")}
            </span>
          ) : null}
        </div>
        <Button aria-busy={saving || undefined} disabled={saving} onClick={onSave}>
          {saving ? t("providers.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function ProviderCredentialSection({
  credentials,
  onCreate,
  onDelete,
  onEdit,
  onSetDefault,
  vendor,
}: {
  credentials: readonly VendorCredential[];
  onCreate: () => void;
  onDelete: (credential: VendorCredential) => void;
  onEdit: (credential: VendorCredential) => void;
  onSetDefault: (credential: VendorCredential) => void;
  vendor: Pick<RuntimeCatalogVendor, "iconKey" | "label" | "vendorId">;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <section className="border-border bg-card space-y-4 rounded-lg border p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {hasVendorIcon(vendor.iconKey) ? (
            <VendorIcon
              className="border-border-soft bg-card size-7 shrink-0 rounded-sm border p-1"
              iconKey={vendor.iconKey}
            />
          ) : null}
          <div className="min-w-0">
            <h2 className="t-section-title truncate">{t(vendor.label)}</h2>
            <p className="text-fg-3 text-[12px] leading-4">{t("providers.projectLevelKeys")}</p>
          </div>
        </div>
        <Button onClick={onCreate} variant="outline">
          <Plus className="size-3.5" />
          {t("providers.addKey")}
        </Button>
      </div>
      {credentials.length > 0 ? (
        <div className="space-y-2">
          {credentials.map((credential) => (
            <ConnectionRow className="justify-between" key={credential.id} tone="tinted">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-fg-1 truncate font-medium">{credential.name}</span>
                  {credential.isDefault ? (
                    <Badge variant="brand">{t("providers.default")}</Badge>
                  ) : null}
                  {credential.vendorId === CUSTOM_PROVIDER_VENDOR_ID ? (
                    <Badge>
                      {credential.modelProtocol === null
                        ? t("providers.protocolUnspecified")
                        : modelProtocolLabel(credential.modelProtocol)}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 flex min-w-0 items-baseline gap-2 leading-4">
                  <MonoText className="text-fg-3 truncate">{credential.maskedApiKey}</MonoText>
                  <span className="text-fg-muted truncate text-[12px]">
                    {displayApiBase(credential, t)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {credential.isDefault ? null : (
                  <Button onClick={() => onSetDefault(credential)} size="sm" variant="ghost">
                    {t("providers.setDefault")}
                  </Button>
                )}
                <Button
                  aria-label={t("providers.editCredentialKey", { name: credential.name })}
                  onClick={() => onEdit(credential)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  aria-label={t("providers.deleteCredentialKey", { name: credential.name })}
                  className="text-danger-fg hover:text-danger-fg"
                  onClick={() => onDelete(credential)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </ConnectionRow>
          ))}
        </div>
      ) : (
        <div className="border-border text-fg-3 flex min-h-10 items-center rounded-md border border-dashed px-3 text-[13px]">
          {t("providers.noKeyConfigured")}
        </div>
      )}
    </section>
  );
}
import type { PresetModelProtocol } from "@mosoo/contracts/models";
