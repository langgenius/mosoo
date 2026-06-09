import { describe, expect, test } from "bun:test";

import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

describe("Agent Builder API fixture", () => {
  test("logs in through the @mosoo.ai development backdoor and reuses the session cookie", async () => {
    const fixture = await createAgentBuilderApiFixture();

    const login = await fixture.client.loginAsMosooAiTestAccount();

    expect(login.user).toMatchObject({
      email: "agent.builder.fixture@mosoo.ai",
      id: "01J00000000000000000000051",
      name: "Agent Builder User",
    });

    const firstSessionViewer = await fixture.client.readAuthenticatedViewerFromSession();
    const secondViewerContext = await fixture.client.readViewerContext();

    expect(firstSessionViewer).toEqual({
      email: "agent.builder.fixture@mosoo.ai",
      emailVerified: true,
      id: "01J00000000000000000000051",
      imageUrl: null,
      name: "Agent Builder User",
    });
    expect(secondViewerContext).toMatchObject({
      account: {
        email: "agent.builder.fixture@mosoo.ai",
        id: "01J00000000000000000000051",
        name: "Agent Builder User",
      },
      activeOrganization: {
        id: "01J00000000000000000000052",
        name: "Mosoo Agent Builder Test",
      },
      auth: {
        currentSecurityLevel: "verified_email",
      },
    });
  });
});
