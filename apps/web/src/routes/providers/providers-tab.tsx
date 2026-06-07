import { Plus } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";

import type { Organization } from "../../domains/organization/api/organization-types";
import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";
import { useProviderCredentialsModel } from "../../domains/vendor-credential/model/provider-credentials-model";
import {
  CustomProviderCard,
  CustomProviderDeleteDialog,
  ProviderCard,
  RuntimeAvailabilitySection,
  SavedCustomProviderCard,
} from "./provider-tab-sections";

const CUSTOM_PROVIDER_VENDOR_ID = "openai-compatible";
const EMPTY_VENDOR_CREDENTIALS: VendorCredential[] = [];
const EMPTY_RUNTIMES: string[] = [];

export function ProvidersTab({ organization }: { organization: Organization }): ReactElement {
  const model = useProviderCredentialsModel({ organization });
  const customProviderCredentials =
    model.credentialsByVendor.get(CUSTOM_PROVIDER_VENDOR_ID) ?? EMPTY_VENDOR_CREDENTIALS;
  const handleAddCustomProvider = model.startAddingCustomProvider;
  const handleCancelCustomProvider = model.cancelCustomProvider;
  const handleCloseCustomProviderDeleteDialog = model.closeCustomProviderDeleteDialog;
  const handleCompanyFormChange = model.setCompanyForm;
  const handleConfirmCustomProviderDelete = model.confirmCustomProviderDelete;
  const handleCustomProviderDeleteDialogOpen = model.openCustomProviderDeleteDialog;
  const handleCustomProviderFormChange = model.setCustomProviderForm;
  const handleCustomProviderKeyVisibilityChange = model.setShowCustomProviderKey;
  const handleDeleteCredential = (credential: VendorCredential) => {
    void model.handleDelete(credential);
  };
  const handlePersonalFormChange = model.setPersonalForm;
  const handlePersonalKeyVisibilityChange = model.setShowPersonalKey;
  const handleSaveCompanyCredential = () => {
    void model.handleSaveCompanyCredential();
  };
  const handleSaveCustomProvider = () => {
    void model.handleSaveCustomProvider();
  };
  const handleSavePersonalCredential = (vendorId: string) => {
    void model.handleSavePersonalCredential(vendorId);
  };
  const handleSetCompanyDefault = (credential: VendorCredential) => {
    void model.handleSetCompanyDefault(credential);
  };
  const handleStartAddingCompanyKey = model.startAddingCompanyKey;
  const handleStartAddingPersonalKey = model.startAddingPersonalKey;
  const handleStartEditingCompanyKey = model.startEditingCompanyKey;
  const handleTestCompanyCredential = () => {
    void model.handleTestCompanyCredential();
  };
  const handleTestCustomProvider = () => {
    void model.handleTestCustomProvider();
  };
  const handleTestPersonalCredential = (vendorId: string) => {
    void model.handleTestPersonalCredential(vendorId);
  };
  const handleUseCompanyDefault = (vendorId: string) => {
    void model.handleUseCompanyDefault(vendorId);
  };
  const handleUsePersonal = (credential: VendorCredential) => {
    void model.handleUsePersonal(credential);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        className="border-border-subtle border-b"
        title="Providers"
        description="Configure provider keys and choose which key each runtime uses."
      >
        <Button onClick={handleAddCustomProvider} size="sm" variant="outline">
          <Plus className="size-3.5" />
          Add OpenAI-compatible provider
        </Button>
      </PageHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {model.loading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-6 text-sm">
              Loading providers…
            </div>
          ) : null}

          {model.error === null ? null : (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
              {model.error}
            </div>
          )}

          {model.loading ? null : (
            <RuntimeAvailabilitySection
              activePersonalByVendor={model.activePersonalByVendor}
              credentials={model.credentials}
              defaultCredentialByVendor={model.defaultCredentialByVendor}
              visibleRuntimes={model.visibleRuntimes}
            />
          )}

          {model.customProviderForm.visible ? (
            <CustomProviderCard
              form={model.customProviderForm}
              onCancel={handleCancelCustomProvider}
              onDelete={handleCustomProviderDeleteDialogOpen}
              onFormChange={handleCustomProviderFormChange}
              onSave={handleSaveCustomProvider}
              onShowKeyChange={handleCustomProviderKeyVisibilityChange}
              onTestConnection={handleTestCustomProvider}
              showKey={model.showCustomProviderKey}
              testError={model.actionError}
              testState={model.customProviderTest}
            />
          ) : null}

          {model.loading
            ? null
            : customProviderCredentials.map((credential) => (
                <SavedCustomProviderCard
                  credential={credential}
                  key={credential.id}
                  onDelete={handleDeleteCredential}
                />
              ))}

          <CustomProviderDeleteDialog
            onCancel={handleCloseCustomProviderDeleteDialog}
            onConfirm={handleConfirmCustomProviderDelete}
            state={model.customProviderDeleteDialog}
          />

          {model.loading
            ? null
            : model.visibleVendors.map((vendor) => {
                const credentials =
                  model.credentialsByVendor.get(vendor.vendorId) ?? EMPTY_VENDOR_CREDENTIALS;
                const runtimes = model.runtimesByVendor.get(vendor.vendorId) ?? EMPTY_RUNTIMES;

                return (
                  <ProviderCard
                    activePersonalByVendor={model.activePersonalByVendor}
                    companyForm={model.companyForm}
                    companyProviderError={model.actionError}
                    companyProviderTest={model.companyProviderTest}
                    credentials={credentials}
                    defaultCredentialByVendor={model.defaultCredentialByVendor}
                    isAdmin={model.isAdmin}
                    key={vendor.vendorId}
                    onCompanyFormChange={handleCompanyFormChange}
                    onDelete={handleDeleteCredential}
                    onPersonalFormChange={handlePersonalFormChange}
                    onSaveCompanyCredential={handleSaveCompanyCredential}
                    onSavePersonalCredential={handleSavePersonalCredential}
                    onSetCompanyDefault={handleSetCompanyDefault}
                    onShowPersonalKeyChange={handlePersonalKeyVisibilityChange}
                    onStartAddingCompanyKey={handleStartAddingCompanyKey}
                    onStartAddingPersonalKey={handleStartAddingPersonalKey}
                    onStartEditingCompanyKey={handleStartEditingCompanyKey}
                    onTestCompanyCredential={handleTestCompanyCredential}
                    onTestPersonalCredential={handleTestPersonalCredential}
                    onUseCompanyDefault={handleUseCompanyDefault}
                    onUsePersonal={handleUsePersonal}
                    personalForm={model.personalForm}
                    personalProviderError={model.actionError}
                    personalProviderTest={model.personalProviderTest}
                    runtimes={runtimes}
                    saving={model.saving}
                    showPersonalKey={model.showPersonalKey}
                    vendor={vendor}
                  />
                );
              })}
        </div>
      </main>
    </div>
  );
}
