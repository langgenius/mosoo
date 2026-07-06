import { describe, expect, test } from "bun:test";

import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { deleteAgentSession } from "../src/modules/sessions/application/session-lifecycle-mutation.service";
import { lookupAppSessionParticipantCapabilityAccess } from "../src/modules/sessions/domain/session-access.policy";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";

const GHOST_SESSION_ID = "01J000000000000000000GHOST";

function ownerViewer(): AuthenticatedViewer {
  return { id: PUBLIC_API_TEST_IDS.ownerAccount } as AuthenticatedViewer;
}

describe("session delete idempotency", () => {
  test("deleting a session that no longer exists succeeds", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      deleteAgentSession({
        bindings: { DB: database } as ApiBindings,
        appId: PUBLIC_API_TEST_IDS.app,
        sessionId: GHOST_SESSION_ID,
        viewer: ownerViewer(),
      }),
    ).resolves.toBeUndefined();
  });

  test("deleting another participant's session stays forbidden", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

    await expect(
      deleteAgentSession({
        bindings: { DB: database } as ApiBindings,
        appId: PUBLIC_API_TEST_IDS.app,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        viewer: ownerViewer(),
      }),
    ).rejects.toThrow("You do not have permission to perform this action.");
  });
});

describe("lookupAppSessionParticipantCapabilityAccess", () => {
  test("distinguishes missing, not_participant, and found", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertNonOwnerSession(database);

    const missing = await lookupAppSessionParticipantCapabilityAccess(
      database,
      PUBLIC_API_TEST_IDS.ownerAccount,
      { appId: PUBLIC_API_TEST_IDS.app, sessionId: GHOST_SESSION_ID },
    );
    expect(missing).toEqual({ kind: "missing" });

    const notParticipant = await lookupAppSessionParticipantCapabilityAccess(
      database,
      PUBLIC_API_TEST_IDS.ownerAccount,
      { appId: PUBLIC_API_TEST_IDS.app, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
    );
    expect(notParticipant).toEqual({ kind: "not_participant" });

    const found = await lookupAppSessionParticipantCapabilityAccess(
      database,
      PUBLIC_API_TEST_IDS.ownerAccount,
      { appId: PUBLIC_API_TEST_IDS.app, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    );
    expect(found.kind).toBe("found");
    if (found.kind === "found") {
      expect(found.row.is_session_creator).toBe(1);
    }
  });
});
