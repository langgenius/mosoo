import { expect, test } from "@playwright/test";

import {
  CONSOLE_FIXTURE_IDS,
  fulfillJson,
  getOperationName,
  installConsoleFixtures,
  parseGraphQLRequestBody,
} from "../../lib/console-fixtures";
import { configureProviderCompanyKey } from "../../lib/setup-agent";

for (const existingDefault of [false, true]) {
  test(`Preview credential helper saves its selected key through the dialog (existing default: ${existingDefault})`, async ({
    page,
  }) => {
    test.setTimeout(30_000);
    page.setDefaultTimeout(5_000);
    await installConsoleFixtures(page, { locale: "en" });
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
        ]
      : [];
    let defaultWrites = 0;
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
          apiBase: null,
          id: "01J00000000000000000000601",
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
        defaultWrites += 1;
        for (const credential of credentials)
          credential["isDefault"] = credential["id"] === "01J00000000000000000000601";
        await fulfillJson(route, {
          setDefaultVendorCredential: credentials.find((credential) => credential["isDefault"]),
        });
        return;
      }
      await route.fallback();
    });
    await configureProviderCompanyKey(page, {
      apiKey: "fixture-not-a-real-key",
      providerId: "openai",
      runId: "dialog-fixture",
    });
    expect(defaultWrites).toBe(existingDefault ? 1 : 0);
    expect(
      credentials.find((credential) => credential["id"] === "01J00000000000000000000601")?.[
        "isDefault"
      ],
    ).toBe(true);
    expect(savedInputs).toEqual([
      expect.objectContaining({
        apiKey: "fixture-not-a-real-key",
        vendorId: "openai",
        name: "Preview smoke dialog-fixture",
        projectId: CONSOLE_FIXTURE_IDS.projectId,
      }),
    ]);
  });
}
