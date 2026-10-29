import { expect, test } from "@playwright/test";

import {
  CONSOLE_FIXTURE_IDS,
  fulfillJson,
  getOperationName,
  installConsoleFixtures,
  parseGraphQLRequestBody,
} from "../../lib/console-fixtures";
import { configureProviderCompanyKey } from "../../lib/setup-agent";

for (const scenario of ["first key", "existing default", "wrong mutation response"] as const) {
  test(`Preview credential helper verifies its saved key (${scenario})`, async ({ page }) => {
    test.setTimeout(60_000);
    await installConsoleFixtures(page, { locale: "en" });
    const existingDefault = scenario !== "first key";
    const savedId = "01J00000000000000000000603";
    const credentials: Record<string, unknown>[] = existingDefault
      ? [
          {
            apiBase: null,
            id: "01J00000000000000000000602",
            isDefault: true,
            maskedApiKey: "fixture-old-key",
            modelProtocol: null,
            models: null,
            name: "Existing default",
            projectId: CONSOLE_FIXTURE_IDS.projectId,
            vendorId: "openai",
          },
          ...["01J00000000000000000000600", "01J00000000000000000000601"].map((id) => ({
            apiBase: null,
            id,
            isDefault: false,
            maskedApiKey: "fixture-unused-key",
            modelProtocol: null,
            models: null,
            name: `Other key ${id}`,
            projectId: CONSOLE_FIXTURE_IDS.projectId,
            vendorId: "openai",
          })),
        ]
      : [];
    const defaultInputs: unknown[] = [];
    const savedInputs: unknown[] = [];
    await page.route("**/api/graphql", async (route) => {
      const body = parseGraphQLRequestBody(route.request().postData());
      const operation = getOperationName(body);
      if (operation === "VendorCredentialList") {
        await fulfillJson(route, { vendorCredentialList: credentials });
        return;
      }
      if (operation === "CreateVendorCredential") {
        savedInputs.push(body.variables?.["input"]);
        const credential = {
          apiBase: "https://api.openai.com/v1",
          id: savedId,
          isDefault: !existingDefault,
          maskedApiKey: "fixture-key",
          modelProtocol: null,
          models: null,
          name: "Preview smoke dialog-fixture",
          projectId: CONSOLE_FIXTURE_IDS.projectId,
          vendorId: "openai",
        };
        credentials.push(credential);
        await fulfillJson(route, { createVendorCredential: credential });
        return;
      }
      if (operation === "SetDefaultVendorCredential") {
        const input = body.variables?.["input"] as { id?: string; projectId?: string };
        defaultInputs.push(input);
        expect(input).toEqual({ id: savedId, projectId: CONSOLE_FIXTURE_IDS.projectId });
        for (const credential of credentials)
          credential["isDefault"] = credential["id"] === input.id;
        const selected = credentials.find((credential) => credential["isDefault"]);
        await fulfillJson(route, {
          setDefaultVendorCredential:
            scenario === "wrong mutation response"
              ? { ...selected, id: "01J00000000000000000000601" }
              : selected,
        });
        return;
      }
      await route.fallback();
    });
    const configuring = configureProviderCompanyKey(page, {
      apiKey: "fixture-not-a-real-key",
      providerId: "openai",
      runId: "dialog-fixture",
    });
    if (scenario === "wrong mutation response") {
      await expect(configuring).rejects.toThrow(
        "Preview default credential response must match the saved credential",
      );
    } else {
      await configuring;
    }
    expect(defaultInputs).toEqual(
      existingDefault ? [{ id: savedId, projectId: CONSOLE_FIXTURE_IDS.projectId }] : [],
    );
    expect(credentials.find((credential) => credential["id"] === savedId)?.["isDefault"]).toBe(
      true,
    );
    expect(savedInputs).toEqual([
      {
        apiBase: "https://api.openai.com/v1",
        apiKey: "fixture-not-a-real-key",
        vendorId: "openai",
        name: "Preview smoke dialog-fixture",
        projectId: CONSOLE_FIXTURE_IDS.projectId,
      },
    ]);
  });
}
