import { Eye, EyeOff } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";

import { canUseCustomEndpoint } from "../../domains/vendor-credential/model/provider-credential-policy";
import { EMPTY_PERSONAL_FORM } from "../../domains/vendor-credential/model/provider-credentials-model";
import type {
  PersonalForm,
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

function getSaveLabel(saving: boolean): string {
  return saving ? "Saving..." : "Save & use";
}

export function ProviderPersonalCredentialForm({
  onPersonalFormChange,
  onSavePersonalCredential,
  onShowPersonalKeyChange,
  onTestPersonalCredential,
  personalForm,
  saving,
  showPersonalKey,
  testError,
  testState,
  vendor,
}: {
  onPersonalFormChange: (form: PersonalForm) => void;
  onSavePersonalCredential: (vendorId: string) => void;
  onShowPersonalKeyChange: (visible: boolean) => void;
  onTestPersonalCredential: (vendorId: string) => void;
  personalForm: PersonalForm;
  saving: boolean;
  showPersonalKey: boolean;
  testError: string | null;
  testState: TestConnectionState;
  vendor: VisibleVendor;
}): ReactElement | null {
  const customEndpointAllowed = canUseCustomEndpoint(vendor.vendorId);
  const initiallyExpanded = customEndpointAllowed && Boolean(personalForm.apiBase);
  const [advancedOpen, setAdvancedOpen] = useState(initiallyExpanded);

  if (personalForm.vendorId !== vendor.vendorId) {
    return null;
  }

  function toggleAdvanced(open: boolean) {
    setAdvancedOpen(open);
    if (!open) {
      onPersonalFormChange({ ...personalForm, apiBase: "" });
    }
  }

  return (
    <div className="border-accent/40 bg-accent-soft/20 space-y-3 rounded-lg border p-3">
      <label className="space-y-1" htmlFor={`personal-credential-${vendor.vendorId}-label`}>
        <div className="text-muted-foreground text-xs font-medium">Label</div>
        <Input
          id={`personal-credential-${vendor.vendorId}-label`}
          placeholder={`${vendor.label} key`}
          value={personalForm.label}
          onChange={(event) => {
            onPersonalFormChange({ ...personalForm, label: event.target.value });
          }}
        />
      </label>
      <label className="block space-y-1" htmlFor={`personal-credential-${vendor.vendorId}-api-key`}>
        <div className="text-muted-foreground text-xs font-medium">API Key</div>
        <div className="flex gap-2">
          <Input
            id={`personal-credential-${vendor.vendorId}-api-key`}
            type={showPersonalKey ? "text" : "password"}
            placeholder="sk-..."
            value={personalForm.apiKey}
            onChange={(event) => {
              onPersonalFormChange({ ...personalForm, apiKey: event.target.value });
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              onShowPersonalKeyChange(!showPersonalKey);
            }}
          >
            {showPersonalKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </label>

      <div className="border-border bg-paper-200/30 rounded-md border border-dashed px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-foreground text-xs font-medium">
              Base URL (override) · advanced
            </div>
            <div className="text-muted-foreground text-[11px]">
              Override default endpoint, e.g. for LiteLLM / Bifrost gateway.
            </div>
          </div>
          <Switch
            checked={advancedOpen}
            disabled={!customEndpointAllowed}
            onCheckedChange={toggleAdvanced}
          />
        </div>
        {advancedOpen && customEndpointAllowed ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder={vendor.defaultApiBase ?? "https://api.example.com/v1"}
                value={personalForm.apiBase}
                onChange={(event) => {
                  onPersonalFormChange({ ...personalForm, apiBase: event.target.value });
                }}
              />
            </div>
          </div>
        ) : null}
        {customEndpointAllowed ? null : (
          <div className="text-muted-foreground/80 mt-2 text-[11px]">
            Canonical providers always use their provider endpoint; toggle is locked.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            disabled={testState === "running"}
            onClick={() => {
              onTestPersonalCredential(vendor.vendorId);
            }}
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
              onPersonalFormChange(EMPTY_PERSONAL_FORM);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onSavePersonalCredential(vendor.vendorId);
            }}
            disabled={saving}
          >
            {getSaveLabel(saving)}
          </Button>
        </div>
      </div>
    </div>
  );
}
