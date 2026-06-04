import { Plus } from "lucide-react";
import { useMemo } from "react";
import type { ReactElement } from "react";

import { VendorIcon, hasVendorIcon } from "@/shared/ui/brand-icons";
import { Button } from "@/shared/ui/button";

import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";
import type {
  CompanyForm,
  PersonalForm,
  TestConnectionState,
} from "../../domains/vendor-credential/model/provider-credentials-model";
import {
  ProviderActiveKeyMenu,
  ProviderCompanyCredentials,
  ProviderPersonalCredentialForm,
} from "./provider-card-sections";
import type { VisibleVendor } from "./provider-card-types";

export function ProviderCard({
  activePersonalByVendor,
  companyForm,
  companyProviderError,
  companyProviderTest,
  credentials,
  defaultCredentialByVendor,
  isAdmin,
  onCompanyFormChange,
  onDelete,
  onPersonalFormChange,
  onSaveCompanyCredential,
  onSavePersonalCredential,
  onSetCompanyDefault,
  onShowPersonalKeyChange,
  onStartAddingCompanyKey,
  onStartAddingPersonalKey,
  onStartEditingCompanyKey,
  onTestCompanyCredential,
  onTestPersonalCredential,
  onUseCompanyDefault,
  onUsePersonal,
  personalForm,
  personalProviderError,
  personalProviderTest,
  runtimes,
  saving,
  showPersonalKey,
  vendor,
}: ProviderCardProperties): ReactElement {
  const companyCredentials = useMemo(
    () => credentials.filter((credential) => credential.scope === "company"),
    [credentials],
  );
  const personalCredentials = useMemo(
    () => credentials.filter((credential) => credential.scope === "personal"),
    [credentials],
  );
  const companyDefault = defaultCredentialByVendor.get(vendor.vendorId);

  return (
    <section className="border-border bg-card space-y-3 rounded-lg border p-4">
      <ProviderCardHeader
        isAdmin={isAdmin}
        onStartAddingCompanyKey={onStartAddingCompanyKey}
        runtimes={runtimes}
        vendor={vendor}
      />

      <ProviderCompanyCredentials
        companyCredentials={companyCredentials}
        companyForm={companyForm}
        isAdmin={isAdmin}
        onCompanyFormChange={onCompanyFormChange}
        onDelete={onDelete}
        onSaveCompanyCredential={onSaveCompanyCredential}
        onSetCompanyDefault={onSetCompanyDefault}
        onStartEditingCompanyKey={onStartEditingCompanyKey}
        onTestCompanyCredential={onTestCompanyCredential}
        saving={saving}
        testError={companyProviderError}
        testState={companyProviderTest}
        vendor={vendor}
      />

      <ProviderActiveKeyMenu
        activePersonal={activePersonalByVendor.get(vendor.vendorId)}
        companyDefault={companyDefault}
        onDelete={onDelete}
        onStartAddingPersonalKey={onStartAddingPersonalKey}
        onUseCompanyDefault={onUseCompanyDefault}
        onUsePersonal={onUsePersonal}
        personalCredentials={personalCredentials}
        vendor={vendor}
      />

      <ProviderPersonalCredentialForm
        onPersonalFormChange={onPersonalFormChange}
        onSavePersonalCredential={onSavePersonalCredential}
        onShowPersonalKeyChange={onShowPersonalKeyChange}
        onTestPersonalCredential={onTestPersonalCredential}
        personalForm={personalForm}
        saving={saving}
        showPersonalKey={showPersonalKey}
        testError={personalProviderError}
        testState={personalProviderTest}
        vendor={vendor}
      />
    </section>
  );
}

interface ProviderCardProperties {
  activePersonalByVendor: Map<string, VendorCredential>;
  companyForm: CompanyForm;
  companyProviderError: string | null;
  companyProviderTest: TestConnectionState;
  credentials: VendorCredential[];
  defaultCredentialByVendor: Map<string, VendorCredential>;
  isAdmin: boolean;
  onCompanyFormChange: (form: CompanyForm) => void;
  onDelete: (credential: VendorCredential) => void;
  onPersonalFormChange: (form: PersonalForm) => void;
  onSaveCompanyCredential: () => void;
  onSavePersonalCredential: (vendorId: string) => void;
  onSetCompanyDefault: (credential: VendorCredential) => void;
  onShowPersonalKeyChange: (visible: boolean) => void;
  onStartAddingCompanyKey: (vendorId: string) => void;
  onStartAddingPersonalKey: (vendorId: string) => void;
  onStartEditingCompanyKey: (credential: VendorCredential) => void;
  onTestCompanyCredential: () => void;
  onTestPersonalCredential: (vendorId: string) => void;
  onUseCompanyDefault: (vendorId: string) => void;
  onUsePersonal: (credential: VendorCredential) => void;
  personalForm: PersonalForm;
  personalProviderError: string | null;
  personalProviderTest: TestConnectionState;
  runtimes: string[];
  saving: boolean;
  showPersonalKey: boolean;
  vendor: VisibleVendor;
}

function ProviderCardHeader({
  isAdmin,
  onStartAddingCompanyKey,
  runtimes,
  vendor,
}: {
  isAdmin: boolean;
  onStartAddingCompanyKey: (vendorId: string) => void;
  runtimes: string[];
  vendor: VisibleVendor;
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {hasVendorIcon(vendor.vendorId) ? (
          <VendorIcon
            className="size-7 shrink-0 rounded-md bg-white p-1"
            vendorId={vendor.vendorId}
          />
        ) : null}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-foreground truncate text-sm font-semibold">{vendor.label}</h2>
          </div>
          <p className="text-muted-foreground truncate text-xs">
            Vendor ID: {vendor.vendorId} · {vendor.apiKeyEnvVar}
            {runtimes.length > 0 ? ` · ${runtimes.join(", ")}` : ""}
          </p>
        </div>
      </div>
      {isAdmin ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onStartAddingCompanyKey(vendor.vendorId);
          }}
        >
          <Plus className="size-3.5" />
          Add Key
        </Button>
      ) : null}
    </div>
  );
}
