import { describe, expect, test } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import type { WorkspaceApiKeyId } from "@mosoo/id";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  authenticateWorkspaceApiKey,
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  revokeWorkspaceApiKey,
} from "../src/modules/auth/application/workspace-api-key.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
  TOKENS,
} from "./helpers/public-api-http-test-fixture";

const OWNER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

describe("Workspace API keys", () => {
  test("creates a key through the active Workspace route", async () => {
    const database = await createPublicHttpContractDatabase();
    const response = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/workspaces/${PUBLIC_API_TEST_IDS.app}/api-keys`,
      {
        body: JSON.stringify({ label: "Production Run key" }),
        headers: {
          authorization: `Bearer ${TOKENS.owner}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    expect(response.status).toBe(201);
    const body = await response.json<{
      key: { label: string; workspaceId: string };
      value: string;
    }>();
    expect(body.key).toMatchObject({
      label: "Production Run key",
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });
    expect(body.value).toStartWith("msk_");

    const caller = await authenticateWorkspaceApiKey(database, body.value);
    expect(caller).toMatchObject({
      viewer: { id: PUBLIC_API_TEST_IDS.ownerAccount },
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });
  });

  test("isolates list and revoke operations to the bound Workspace", async () => {
    const database = await createPublicHttpContractDatabase();
    const created = await createWorkspaceApiKey(database, OWNER, {
      label: "Experiment",
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });

    expect(await listWorkspaceApiKeys(database, OWNER, PUBLIC_API_TEST_IDS.app)).toMatchObject({
      keys: [{ id: created.key.id, workspaceId: PUBLIC_API_TEST_IDS.app }],
    });

    await revokeWorkspaceApiKey(database, OWNER, {
      keyId: created.key.id as WorkspaceApiKeyId,
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });

    expect(await authenticateWorkspaceApiKey(database, created.value)).toBeNull();
    expect(await listWorkspaceApiKeys(database, OWNER, PUBLIC_API_TEST_IDS.app)).toEqual({
      keys: [],
    });
  });

  test("does not let another account mint a key for the Workspace", async () => {
    const database = await createPublicHttpContractDatabase();
    const response = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/workspaces/${PUBLIC_API_TEST_IDS.app}/api-keys`,
      {
        body: JSON.stringify({ label: "Cross-tenant key" }),
        headers: {
          authorization: `Bearer ${TOKENS.nonOwner}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    expect(response.status).toBe(403);
  });
});
