import { toOrganizationId } from "@/routes/typed-id";

import { testVendorCredential } from "../api/vendor-credential-client";
import { canUseCustomEndpoint } from "./provider-credential-endpoint";
import { getErrorMessage } from "./provider-credential-error";
import type {
  CompanyForm,
  CustomProviderForm,
  PersonalForm,
  TestConnectionState,
} from "./provider-credential-form-state";
import { formatProviderErrorMessage } from "./provider-readiness-copy";

type Setter<T> = (value: T) => void;

interface ProviderCredentialTestActionsInput {
  companyForm: CompanyForm;
  companyProviderTest: TestConnectionState;
  customProviderForm: CustomProviderForm;
  customProviderTest: TestConnectionState;
  isAdmin: boolean;
  organizationId: string;
  personalForm: PersonalForm;
  personalProviderTest: TestConnectionState;
  setActionError: Setter<string | null>;
  setCompanyProviderTest: Setter<TestConnectionState>;
  setCustomProviderTest: Setter<TestConnectionState>;
  setPersonalProviderTest: Setter<TestConnectionState>;
}

export interface ProviderCredentialTestActions {
  handleTestCompanyCredential: () => Promise<void>;
  handleTestCustomProvider: () => Promise<void>;
  handleTestPersonalCredential: (vendorId: string) => Promise<void>;
}

export function createProviderCredentialTestActions(
  input: ProviderCredentialTestActionsInput,
): ProviderCredentialTestActions {
  const handleTestCustomProvider = async (): Promise<void> => {
    if (input.customProviderTest === "running") {
      return;
    }

    const baseUrl = input.customProviderForm.baseUrl.trim();
    const apiKey = input.customProviderForm.apiKey.trim();
    const firstModelId =
      input.customProviderForm.models
        .map((modelId) => modelId.trim())
        .find((modelId) => modelId.length > 0) ?? null;

    if (baseUrl.length === 0 || apiKey.length === 0) {
      input.setActionError("Provide a base URL and API key before testing.");
      return;
    }

    input.setCustomProviderTest("running");
    input.setActionError(null);

    try {
      const result = await testVendorCredential({
        apiBase: baseUrl,
        apiKey,
        modelId: firstModelId,
        organizationId: toOrganizationId(input.organizationId),
        scope: input.isAdmin ? "company" : "personal",
        vendorId: "openai-compatible",
      });
      input.setCustomProviderTest(result.ok ? "success" : "failure");
      if (!result.ok && result.errorCode !== null) {
        input.setActionError(formatProviderErrorMessage(result.errorCode));
      }
    } catch (nextError: unknown) {
      input.setCustomProviderTest("failure");
      input.setActionError(
        formatProviderErrorMessage(getErrorMessage(nextError, "Connection test failed.")),
      );
    }
  };

  const handleTestCompanyCredential = async (): Promise<void> => {
    if (input.companyProviderTest === "running") {
      return;
    }

    const apiKey = input.companyForm.apiKey.trim();

    if (input.companyForm.vendorId.length === 0 || apiKey.length === 0) {
      input.setActionError("Provide an API key before testing.");
      return;
    }

    input.setCompanyProviderTest("running");
    input.setActionError(null);

    try {
      const result = await testVendorCredential({
        apiBase: canUseCustomEndpoint(input.companyForm.vendorId)
          ? input.companyForm.apiBase.trim() || null
          : null,
        apiKey,
        organizationId: toOrganizationId(input.organizationId),
        scope: "company",
        vendorId: input.companyForm.vendorId,
      });
      input.setCompanyProviderTest(result.ok ? "success" : "failure");
      if (!result.ok && result.errorCode !== null) {
        input.setActionError(formatProviderErrorMessage(result.errorCode));
      }
    } catch (nextError: unknown) {
      input.setCompanyProviderTest("failure");
      input.setActionError(
        formatProviderErrorMessage(getErrorMessage(nextError, "Connection test failed.")),
      );
    }
  };

  const handleTestPersonalCredential = async (vendorId: string): Promise<void> => {
    if (input.personalProviderTest === "running") {
      return;
    }

    const apiKey = input.personalForm.apiKey.trim();

    if (apiKey.length === 0) {
      input.setActionError("Provide an API key before testing.");
      return;
    }

    input.setPersonalProviderTest("running");
    input.setActionError(null);

    try {
      const result = await testVendorCredential({
        apiBase: canUseCustomEndpoint(vendorId) ? input.personalForm.apiBase.trim() || null : null,
        apiKey,
        organizationId: toOrganizationId(input.organizationId),
        scope: "personal",
        vendorId,
      });
      input.setPersonalProviderTest(result.ok ? "success" : "failure");
      if (!result.ok && result.errorCode !== null) {
        input.setActionError(formatProviderErrorMessage(result.errorCode));
      }
    } catch (nextError: unknown) {
      input.setPersonalProviderTest("failure");
      input.setActionError(
        formatProviderErrorMessage(getErrorMessage(nextError, "Connection test failed.")),
      );
    }
  };

  return {
    handleTestCompanyCredential,
    handleTestCustomProvider,
    handleTestPersonalCredential,
  };
}
