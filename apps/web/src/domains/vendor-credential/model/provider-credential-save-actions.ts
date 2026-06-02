import { PUBLIC_VENDORS } from "@mosoo/runtime-catalog";

import { toOrganizationId, toVendorCredentialId } from "@/routes/typed-id";

import {
  createVendorCredential,
  deleteVendorCredential,
  updateVendorCredential,
} from "../api/vendor-credential-client";
import type { VendorCredential } from "../api/vendor-credential-client";
import { getErrorMessage } from "./provider-credential-error";
import {
  EMPTY_COMPANY_FORM,
  EMPTY_CUSTOM_PROVIDER_FORM,
  EMPTY_DELETE_DIALOG_STATE,
  EMPTY_PERSONAL_FORM,
} from "./provider-credential-form-state";
import type {
  CompanyForm,
  CustomProviderDeleteDialogState,
  CustomProviderForm,
  PersonalForm,
  TestConnectionState,
} from "./provider-credential-form-state";
import { canUseCustomEndpoint } from "./provider-credential-policy";

type Setter<T> = (value: T) => void;

interface ProviderCredentialSaveActionsInput {
  companyForm: CompanyForm;
  credentials: VendorCredential[];
  customProviderForm: CustomProviderForm;
  isAdmin: boolean;
  organizationId: string;
  personalForm: PersonalForm;
  refreshCredentials: () => Promise<void>;
  setActionError: Setter<string | null>;
  setCompanyForm: Setter<CompanyForm>;
  setCompanyProviderTest: Setter<TestConnectionState>;
  setCustomProviderDeleteDialog: Setter<CustomProviderDeleteDialogState>;
  setCustomProviderForm: Setter<CustomProviderForm>;
  setCustomProviderTest: Setter<TestConnectionState>;
  setPersonalForm: Setter<PersonalForm>;
  setPersonalProviderTest: Setter<TestConnectionState>;
  setSaving: Setter<boolean>;
  setShowCustomProviderKey: Setter<boolean>;
  setShowPersonalKey: Setter<boolean>;
}

export interface ProviderCredentialSaveActions {
  cancelCustomProvider: () => void;
  closeCustomProviderDeleteDialog: () => void;
  confirmCustomProviderDelete: () => void;
  handleDelete: (credential: VendorCredential) => Promise<void>;
  handleSaveCompanyCredential: () => Promise<void>;
  handleSaveCustomProvider: () => Promise<void>;
  handleSavePersonalCredential: (vendorId: string) => Promise<void>;
  handleSetCompanyDefault: (credential: VendorCredential) => Promise<void>;
  handleUseCompanyDefault: (vendorId: string) => Promise<void>;
  handleUsePersonal: (credential: VendorCredential) => Promise<void>;
  openCustomProviderDeleteDialog: () => void;
  startAddingCompanyKey: (vendorId: string) => void;
  startAddingCustomProvider: () => void;
  startAddingPersonalKey: (vendorId: string) => void;
  startEditingCompanyKey: (credential: VendorCredential) => void;
  updateCompanyForm: (form: CompanyForm) => void;
  updatePersonalForm: (form: PersonalForm) => void;
}

export function createProviderCredentialSaveActions(
  input: ProviderCredentialSaveActionsInput,
): ProviderCredentialSaveActions {
  const resetTests = (): void => {
    input.setCompanyProviderTest("idle");
    input.setCustomProviderTest("idle");
    input.setPersonalProviderTest("idle");
  };

  const updateCompanyForm = (form: CompanyForm): void => {
    input.setCompanyForm(form);
    input.setCompanyProviderTest("idle");
    input.setActionError(null);
  };

  const updatePersonalForm = (form: PersonalForm): void => {
    input.setPersonalForm(form);
    input.setPersonalProviderTest("idle");
    input.setActionError(null);
  };

  const startAddingCompanyKey = (vendorId: string): void => {
    input.setCompanyForm({ ...EMPTY_COMPANY_FORM, vendorId });
    input.setPersonalForm(EMPTY_PERSONAL_FORM);
    resetTests();
    input.setActionError(null);
  };

  const startEditingCompanyKey = (credential: VendorCredential): void => {
    input.setCompanyForm({
      apiBase: canUseCustomEndpoint(credential.vendorId) ? (credential.apiBase ?? "") : "",
      apiKey: "",
      id: credential.id,
      isDefault: credential.isDefault,
      name: credential.name,
      vendorId: credential.vendorId,
    });
    input.setPersonalForm(EMPTY_PERSONAL_FORM);
    resetTests();
    input.setActionError(null);
  };

  const startAddingPersonalKey = (vendorId: string): void => {
    input.setPersonalForm({ ...EMPTY_PERSONAL_FORM, vendorId });
    input.setCompanyForm(EMPTY_COMPANY_FORM);
    input.setShowPersonalKey(false);
    resetTests();
    input.setActionError(null);
  };

  const handleSaveCompanyCredential = async (): Promise<void> => {
    if (!input.isAdmin) {
      return;
    }

    const name = input.companyForm.name.trim();
    const apiKey = input.companyForm.apiKey.trim();
    if (name.length === 0 || (input.companyForm.id === null && apiKey.length === 0)) {
      input.setActionError(
        input.companyForm.id === null ? "Name and API Key are required." : "Name is required.",
      );
      return;
    }

    input.setSaving(true);
    input.setActionError(null);

    try {
      const apiBase = canUseCustomEndpoint(input.companyForm.vendorId)
        ? input.companyForm.apiBase.trim() || null
        : null;

      const saveCredential =
        input.companyForm.id === null
          ? createVendorCredential({
              apiBase,
              apiKey,
              isDefault: input.companyForm.isDefault,
              name,
              organizationId: toOrganizationId(input.organizationId),
              scope: "company",
              vendorId: input.companyForm.vendorId,
            })
          : updateVendorCredential({
              apiBase,
              ...(apiKey.length > 0 ? { apiKey } : {}),
              id: toVendorCredentialId(input.companyForm.id),
              isDefault: input.companyForm.isDefault,
              name,
            });
      await saveCredential;

      await input.refreshCredentials();
      input.setCompanyForm(EMPTY_COMPANY_FORM);
      input.setCompanyProviderTest("idle");
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to save."));
    } finally {
      input.setSaving(false);
    }
  };

  const handleSavePersonalCredential = async (vendorId: string): Promise<void> => {
    const vendor = PUBLIC_VENDORS.find((candidate) => candidate.vendorId === vendorId);
    const label = input.personalForm.label.trim() || `${vendor?.label ?? "Provider"} key`;
    const apiKey = input.personalForm.apiKey.trim();

    if (apiKey.length === 0) {
      input.setActionError("API Key is required.");
      return;
    }

    input.setSaving(true);
    input.setActionError(null);

    try {
      await createVendorCredential({
        apiBase: canUseCustomEndpoint(vendorId) ? input.personalForm.apiBase.trim() || null : null,
        apiKey,
        isPreferred: true,
        name: label,
        organizationId: toOrganizationId(input.organizationId),
        scope: "personal",
        vendorId,
      });
      await input.refreshCredentials();
      input.setPersonalForm(EMPTY_PERSONAL_FORM);
      input.setPersonalProviderTest("idle");
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to save."));
    } finally {
      input.setSaving(false);
    }
  };

  const handleSetCompanyDefault = async (credential: VendorCredential): Promise<void> => {
    if (!input.isAdmin) {
      return;
    }

    try {
      await updateVendorCredential({ id: credential.id, isDefault: true });
      await input.refreshCredentials();
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to update default credential."));
    }
  };

  const handleUsePersonal = async (credential: VendorCredential): Promise<void> => {
    if (credential.disabledByPolicy) {
      return;
    }

    try {
      await updateVendorCredential({ id: credential.id, isPreferred: true });
      await input.refreshCredentials();
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to switch active key."));
    }
  };

  const handleUseCompanyDefault = async (vendorId: string): Promise<void> => {
    const preferred = input.credentials.find(
      (credential) =>
        credential.vendorId === vendorId &&
        credential.scope === "personal" &&
        credential.isPreferred,
    );

    if (preferred === undefined) {
      return;
    }

    try {
      await updateVendorCredential({ id: preferred.id, isPreferred: false });
      await input.refreshCredentials();
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to switch active key."));
    }
  };

  const handleDelete = async (credential: VendorCredential): Promise<void> => {
    try {
      await deleteVendorCredential(credential.id);
      await input.refreshCredentials();
      if (input.companyForm.id === credential.id) {
        input.setCompanyForm(EMPTY_COMPANY_FORM);
        input.setCompanyProviderTest("idle");
      }
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to delete."));
    }
  };

  const startAddingCustomProvider = (): void => {
    input.setCustomProviderForm({ ...EMPTY_CUSTOM_PROVIDER_FORM, visible: true });
    input.setShowCustomProviderKey(false);
    input.setCustomProviderTest("idle");
    input.setCompanyForm(EMPTY_COMPANY_FORM);
    input.setPersonalForm(EMPTY_PERSONAL_FORM);
    resetTests();
    input.setActionError(null);
  };

  const cancelCustomProvider = (): void => {
    input.setCustomProviderForm(EMPTY_CUSTOM_PROVIDER_FORM);
    input.setShowCustomProviderKey(false);
    input.setCustomProviderTest("idle");
    input.setActionError(null);
  };

  const handleSaveCustomProvider = async (): Promise<void> => {
    const label = input.customProviderForm.label.trim();
    const baseUrl = input.customProviderForm.baseUrl.trim();
    const apiKey = input.customProviderForm.apiKey.trim();
    const models = [
      ...new Set(
        input.customProviderForm.models.flatMap((modelId) => {
          const trimmed = modelId.trim();
          return trimmed.length > 0 ? [trimmed] : [];
        }),
      ),
    ];

    if (label.length === 0 || baseUrl.length === 0 || apiKey.length === 0 || models.length === 0) {
      input.setActionError(
        "Custom Provider requires a label, base URL, API key, and at least one model id.",
      );
      return;
    }

    input.setSaving(true);
    input.setActionError(null);

    try {
      await createVendorCredential({
        apiBase: baseUrl,
        apiKey,
        isDefault: input.isAdmin,
        isPreferred: !input.isAdmin,
        models,
        name: label,
        organizationId: toOrganizationId(input.organizationId),
        scope: input.isAdmin ? "company" : "personal",
        vendorId: "openai-compatible",
      });
      await input.refreshCredentials();
      cancelCustomProvider();
    } catch (nextError: unknown) {
      input.setActionError(getErrorMessage(nextError, "Failed to save Custom Provider."));
    } finally {
      input.setSaving(false);
    }
  };

  const openCustomProviderDeleteDialog = (): void => {
    input.setCustomProviderDeleteDialog({
      label: input.customProviderForm.label.trim() || "Custom Provider",
      open: true,
    });
  };

  const closeCustomProviderDeleteDialog = (): void => {
    input.setCustomProviderDeleteDialog(EMPTY_DELETE_DIALOG_STATE);
  };

  const confirmCustomProviderDelete = (): void => {
    input.setCustomProviderDeleteDialog(EMPTY_DELETE_DIALOG_STATE);
    cancelCustomProvider();
  };

  return {
    cancelCustomProvider,
    closeCustomProviderDeleteDialog,
    confirmCustomProviderDelete,
    handleDelete,
    handleSaveCompanyCredential,
    handleSaveCustomProvider,
    handleSavePersonalCredential,
    handleSetCompanyDefault,
    handleUseCompanyDefault,
    handleUsePersonal,
    openCustomProviderDeleteDialog,
    startAddingCompanyKey,
    startAddingCustomProvider,
    startAddingPersonalKey,
    startEditingCompanyKey,
    updateCompanyForm,
    updatePersonalForm,
  };
}
