import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { restartDriver } from "../src/modules/runtime/application/runtime-state-operations.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/published-agent-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

describe("runtime state operation target version", () => {
  test("requires the observed live version for published Agents", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      restartDriver(createPublicHttpTestBindings(database) as ApiBindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_LIVE_VERSION_REQUIRED",
      status: 409,
    });
  });

  test("returns conflict when the observed live version has drifted", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      restartDriver(createPublicHttpTestBindings(database) as ApiBindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        targetVersion: {
          id: PUBLIC_API_TEST_IDS.deployment,
          versionNumber: 0,
        },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_LIVE_VERSION_CONFLICT",
      status: 409,
    });
  });

  test("accepts the current observed live version", async () => {
    const database = await createPublicHttpContractDatabase();

    const result = await restartDriver(
      createPublicHttpTestBindings(database) as ApiBindings,
      OWNER_VIEWER,
      {
        agentId: PUBLIC_API_TEST_IDS.agent,
        targetVersion: {
          id: PUBLIC_API_TEST_IDS.deployment,
          versionNumber: 1,
        },
      },
    );

    expect(result).toEqual({
      affectedSessionCount: 0,
      agentId: PUBLIC_API_TEST_IDS.agent,
      ok: true,
      operation: "restartDriver",
    });
  });
});
