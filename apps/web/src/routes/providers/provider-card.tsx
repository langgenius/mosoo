import type { ReactElement } from "react";
import { useMemo } from "react";

import { VendorIcon, hasVendorIcon } from "@/shared/ui/brand-icons";

import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";
import type {
  CompanyForm,
  PersonalForm,
  TestConnectionState,
} from "../../domains/vendor-credential/model/provider-credentials-model";
import { ProviderActiveKeyMenu, ProviderPersonalCredentialForm } from "./provider-card-sections";
import type { VisibleVendor } from "./provider-card-types";

export function ProviderCard({
  activePersonalByVendor,
  credentials,
  onDelete,
  onPersonalFormChange,
  onSavePersonalCredential,
  onShowPersonalKeyChange,
  onStartAddingPersonalKey,
  onTestPersonalCredential,
  onUsePersonal,
  personalForm,
  personalProviderError,
  personalProviderTest,
  runtimes,
  saving,
  showPersonalKey,
  vendor,
}: ProviderCardProperties): ReactElement {
  const personalCredentials = useMemo(
    () => credentials.filter((credential) => credential.scope === "personal"),
    [credentials],
  );

  return (
    <section className="border-border bg-card space-y-3 rounded-lg border p-4">
      <ProviderCardHeader runtimes={runtimes} vendor={vendor} />

      <ProviderActiveKeyMenu
        activePersonal={activePersonalByVendor.get(vendor.vendorId)}
        onDelete={onDelete}
        onStartAddingPersonalKey={onStartAddingPersonalKey}
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

// The provider credential model still surfaces company/app-level fields; the
// console intentionally only renders personal-key management, so the unused
// company props are accepted here but not threaded into the card UI.
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
  runtimes,
  vendor,
}: {
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
    </div>
  );
}
