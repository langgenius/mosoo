import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { agentKeys } from "@/domains/agent/query/agent-queries";

import type { VendorCredential } from "../api/vendor-credential-client";
import { useProviderCredentialDerivedModel } from "./provider-credential-derived-model";
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
import { useVendorCredentialsQuery } from "./provider-credential-query";
import { createProviderCredentialSaveActions } from "./provider-credential-save-actions";
import type { ProviderCredentialSaveActions } from "./provider-credential-save-actions";
import { createProviderCredentialTestActions } from "./provider-credential-test-actions";
import type { ProviderCredentialTestActions } from "./provider-credential-test-actions";

export type {
  CompanyForm,
  CustomProviderDeleteDialogState,
  CustomProviderForm,
  PersonalForm,
  TestConnectionState,
} from "./provider-credential-form-state";

export { EMPTY_COMPANY_FORM, EMPTY_PERSONAL_FORM } from "./provider-credential-form-state";

export interface ProviderCredentialsModel
  extends ProviderCredentialSaveActions, ProviderCredentialTestActions {
  actionError: string | null;
  activePersonalByVendor: Map<string, VendorCredential>;
  closeCustomProviderDeleteDialog: () => void;
  companyForm: CompanyForm;
  companyProviderTest: TestConnectionState;
  credentials: VendorCredential[];
  credentialsByVendor: Map<string, VendorCredential[]>;
  customProviderDeleteDialog: CustomProviderDeleteDialogState;
  customProviderForm: CustomProviderForm;
  customProviderTest: TestConnectionState;
  defaultCredentialByVendor: Map<string, VendorCredential>;
  error: string | null;
  isAdmin: boolean;
  loading: boolean;
  personalForm: PersonalForm;
  personalProviderTest: TestConnectionState;
  policy: ReturnType<typeof useVendorCredentialsQuery>["policy"];
  runtimesByVendor: Map<string, string[]>;
  saving: boolean;
  setCompanyForm: (form: CompanyForm) => void;
  setCustomProviderForm: (form: CustomProviderForm) => void;
  setPersonalForm: (form: PersonalForm) => void;
  setShowCustomProviderKey: (visible: boolean) => void;
  setShowPersonalKey: (visible: boolean) => void;
  showCustomProviderKey: boolean;
  showPersonalKey: boolean;
  visibleRuntimes: ReturnType<typeof useProviderCredentialDerivedModel>["visibleRuntimes"];
  visibleVendors: ReturnType<typeof useProviderCredentialDerivedModel>["visibleVendors"];
}

export function useProviderCredentialsModel({
  organization,
}: {
  organization: OrganizationSummary;
}): ProviderCredentialsModel {
  const [actionError, setActionError] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY_FORM);
  const [personalForm, setPersonalForm] = useState<PersonalForm>(EMPTY_PERSONAL_FORM);
  const [showPersonalKey, setShowPersonalKey] = useState(false);
  const [personalProviderTest, setPersonalProviderTest] = useState<TestConnectionState>("idle");
  const [saving, setSaving] = useState(false);
  const [customProviderForm, setCustomProviderForm] = useState<CustomProviderForm>(
    EMPTY_CUSTOM_PROVIDER_FORM,
  );
  const [showCustomProviderKey, setShowCustomProviderKey] = useState(false);
  const [companyProviderTest, setCompanyProviderTest] = useState<TestConnectionState>("idle");
  const [customProviderTest, setCustomProviderTest] = useState<TestConnectionState>("idle");
  const [customProviderDeleteDialog, setCustomProviderDeleteDialog] =
    useState<CustomProviderDeleteDialogState>(EMPTY_DELETE_DIALOG_STATE);
  const isAdmin = can(organization.viewerRole, Permission.ProvidersCompanyManage);
  const queryClient = useQueryClient();
  const { credentials, credentialsQuery, loading, policy } = useVendorCredentialsQuery(
    organization.id,
    isAdmin,
  );
  const error =
    actionError ??
    (credentialsQuery.error ? getErrorMessage(credentialsQuery.error, "Failed to load.") : null);
  const {
    activePersonalByVendor,
    credentialsByVendor,
    defaultCredentialByVendor,
    runtimesByVendor,
    visibleRuntimes,
    visibleVendors,
  } = useProviderCredentialDerivedModel({ credentials, isAdmin, policy });

  async function refreshCredentials(): Promise<void> {
    await Promise.all([
      credentialsQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: agentKeys.editorStates() }),
      queryClient.invalidateQueries({ queryKey: ["available-agent-models"] }),
    ]);
  }

  function updateCustomProviderForm(form: CustomProviderForm): void {
    setCustomProviderForm(form);
    setCustomProviderTest("idle");
    setActionError(null);
  }

  const saveActions = createProviderCredentialSaveActions({
    companyForm,
    credentials,
    customProviderForm,
    isAdmin,
    organizationId: organization.id,
    personalForm,
    refreshCredentials,
    setActionError,
    setCompanyForm,
    setCompanyProviderTest,
    setCustomProviderDeleteDialog,
    setCustomProviderForm,
    setCustomProviderTest,
    setPersonalForm,
    setPersonalProviderTest,
    setSaving,
    setShowCustomProviderKey,
    setShowPersonalKey,
  });

  const testActions = createProviderCredentialTestActions({
    companyForm,
    companyProviderTest,
    customProviderForm,
    customProviderTest,
    isAdmin,
    organizationId: organization.id,
    personalForm,
    personalProviderTest,
    setActionError,
    setCompanyProviderTest,
    setCustomProviderTest,
    setPersonalProviderTest,
  });

  return {
    actionError,
    activePersonalByVendor,
    companyForm,
    companyProviderTest,
    credentials,
    credentialsByVendor,
    customProviderDeleteDialog,
    customProviderForm,
    customProviderTest,
    defaultCredentialByVendor,
    error,
    isAdmin,
    loading,
    personalForm,
    personalProviderTest,
    policy,
    runtimesByVendor,
    saving,
    ...saveActions,
    ...testActions,
    setCompanyForm: saveActions.updateCompanyForm,
    setCustomProviderForm: updateCustomProviderForm,
    setPersonalForm: saveActions.updatePersonalForm,
    setShowCustomProviderKey,
    setShowPersonalKey,
    showCustomProviderKey,
    showPersonalKey,
    visibleRuntimes,
    visibleVendors,
  };
}
