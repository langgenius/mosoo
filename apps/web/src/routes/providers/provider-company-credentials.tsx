import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";
import { canUseCustomEndpoint } from "../../domains/vendor-credential/model/provider-credential-policy";
import { EMPTY_COMPANY_FORM } from "../../domains/vendor-credential/model/provider-credentials-model";
import type {
  CompanyForm,
  TestConnectionState,
} from "../../domains/vendor-credential/model/provider-credentials-model";
import { RETRY_PROVIDER_CHECK_TEXT } from "../../domains/vendor-credential/model/provider-readiness-copy";
import type { VisibleVendor } from "./provider-card-types";
import { ProviderTestStatus } from "./provider-test-status";

function getConnectionTestLabel(testState: TestConnectionState): string {
  if (testState === "running") {
    return "Testing...";
  }

  return testState === "failure" ? RETRY_PROVIDER_CHECK_TEXT : "Test";
}

function getCompanySaveLabel(companyForm: CompanyForm, saving: boolean): string {
  if (saving) {
    return "Saving...";
  }

  return companyForm.id === null ? "Save" : "Save changes";
}

export function ProviderCompanyCredentials({
  companyCredentials,
  companyForm,
  isAdmin,
  onCompanyFormChange,
  onDelete,
  onSaveCompanyCredential,
  onSetCompanyDefault,
  onStartEditingCompanyKey,
  onTestCompanyCredential,
  saving,
  testError,
  testState,
  vendor,
}: {
  companyCredentials: VendorCredential[];
  companyForm: CompanyForm;
  isAdmin: boolean;
  onCompanyFormChange: (form: CompanyForm) => void;
  onDelete: (credential: VendorCredential) => void;
  onSaveCompanyCredential: () => void;
  onSetCompanyDefault: (credential: VendorCredential) => void;
  onStartEditingCompanyKey: (credential: VendorCredential) => void;
  onTestCompanyCredential: () => void;
  saving: boolean;
  testError: string | null;
  testState: TestConnectionState;
  vendor: VisibleVendor;
}): ReactElement {
  return (
    <>
      {companyCredentials.length > 0 ? (
        <div className="space-y-2">
          {companyCredentials.map((credential) => (
            <div
              key={credential.id}
              className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-foreground truncate text-sm font-medium">
                    {credential.name}
                  </span>
                  {credential.isDefault ? <Badge variant="primary">Default</Badge> : null}
                  {credential.disabledByPolicy ? (
                    <Badge variant="outline">Disabled by policy</Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground truncate font-mono text-xs">
                  {credential.maskedApiKey}
                  <span className="text-muted-foreground/60 ml-2">
                    {(canUseCustomEndpoint(credential.vendorId) ? credential.apiBase : null) ??
                      vendor.defaultApiBase ??
                      "Provider default endpoint"}
                  </span>
                </div>
              </div>
              {isAdmin ? (
                <div className="flex shrink-0 items-center gap-1">
                  {credential.isDefault ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onSetCompanyDefault(credential);
                      }}
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onStartEditingCompanyKey(credential);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      onDelete(credential);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground/60 px-1 text-xs">No company keys configured.</div>
      )}

      {companyForm.vendorId === vendor.vendorId ? (
        <div className="border-border bg-background space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1" htmlFor={`company-credential-${vendor.vendorId}-name`}>
              <div className="text-muted-foreground text-xs font-medium">Name</div>
              <Input
                id={`company-credential-${vendor.vendorId}-name`}
                placeholder="e.g. Production"
                value={companyForm.name}
                onChange={(event) => {
                  onCompanyFormChange({ ...companyForm, name: event.target.value });
                }}
              />
            </label>
            <label className="space-y-1" htmlFor={`company-credential-${vendor.vendorId}-endpoint`}>
              <div className="text-muted-foreground text-xs font-medium">Custom Endpoint</div>
              <Input
                disabled={!canUseCustomEndpoint(vendor.vendorId)}
                id={`company-credential-${vendor.vendorId}-endpoint`}
                placeholder={
                  canUseCustomEndpoint(vendor.vendorId)
                    ? (vendor.defaultApiBase ?? "https://api.example.com/v1")
                    : "OpenAI-compatible provider only"
                }
                value={companyForm.apiBase}
                onChange={(event) => {
                  onCompanyFormChange({ ...companyForm, apiBase: event.target.value });
                }}
              />
              <div className="text-muted-foreground text-[11px]">
                {canUseCustomEndpoint(vendor.vendorId)
                  ? "Optional base URL for OpenAI-compatible APIs."
                  : "Canonical providers always use their provider endpoint."}
              </div>
            </label>
          </div>
          <label
            className="block space-y-1"
            htmlFor={`company-credential-${vendor.vendorId}-api-key`}
          >
            <div className="text-muted-foreground text-xs font-medium">API Key</div>
            <Input
              id={`company-credential-${vendor.vendorId}-api-key`}
              type="password"
              placeholder={companyForm.id === null ? "sk-..." : "Leave blank to keep current key"}
              value={companyForm.apiKey}
              onChange={(event) => {
                onCompanyFormChange({ ...companyForm, apiKey: event.target.value });
              }}
            />
          </label>
          <label className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <input
              aria-label="Use as default credential for this provider"
              type="checkbox"
              checked={companyForm.isDefault}
              onChange={(event) => {
                onCompanyFormChange({ ...companyForm, isDefault: event.target.checked });
              }}
            />
            Use as default credential for this provider
          </label>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                disabled={testState === "running"}
                onClick={onTestCompanyCredential}
                size="sm"
                type="button"
                variant="outline"
              >
                {getConnectionTestLabel(testState)}
              </Button>
              <ProviderTestStatus error={testError} state={testState} />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onCompanyFormChange(EMPTY_COMPANY_FORM);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={onSaveCompanyCredential} disabled={saving}>
                {getCompanySaveLabel(companyForm, saving)}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
