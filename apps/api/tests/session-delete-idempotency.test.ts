import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { deleteAgentSession } from "../src/modules/sessions/application/session-lifecycle-mutation.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";

const GHOST_SESSION_ID = "01J000000000000000000GHOST";

function viewer(id: string): AuthenticatedViewer {
  return { id } as AuthenticatedViewer;
}

describe("session delete idempotency", () => {
  test("deleting a session that no longer exists succeeds", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      deleteAgentSession({
        bindings: { DB: database } as ApiBindings,
        projectId: PUBLIC_API_TEST_IDS.project,
        sessionId: GHOST_SESSION_ID,
        viewer: viewer(PUBLIC_API_TEST_IDS.ownerAccount),
      }),
    ).resolves.toBeUndefined();
  });

  test("deleting a session in a Project the viewer does not own stays forbidden", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);

    for (const sessionId of [PUBLIC_API_TEST_IDS.ownerSession, GHOST_SESSION_ID]) {
      await expect(
        deleteAgentSession({
          bindings: { DB: database } as ApiBindings,
          projectId: PUBLIC_API_TEST_IDS.project,
          sessionId,
          viewer: viewer(PUBLIC_API_TEST_IDS.nonOwnerAccount),
        }),
      ).rejects.toThrow("You do not have permission to perform this action.");
    }
  });
});
