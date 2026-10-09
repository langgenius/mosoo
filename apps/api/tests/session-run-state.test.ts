import { describe, expect, test } from "bun:test";

import {
  acquireSessionRunDispatch,
  updateSessionRunStatusIfActive,
} from "../src/modules/runtime/application/session-runs/session-run-state.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const ACTIVE_TRANSITION_RUN_ID = "01J0000000000000000000R001";

describe("session run state", () => {
  test("returns active status transitions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, { id: ACTIVE_TRANSITION_RUN_ID, status: "queued" });

    const run = await updateSessionRunStatusIfActive(database, {
      runId: ACTIVE_TRANSITION_RUN_ID,
      status: "booting",
    });

    expect(run?.id).toBe(ACTIVE_TRANSITION_RUN_ID);
    expect(run?.status).toBe("booting");

    const stored = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(ACTIVE_TRANSITION_RUN_ID)
      .first<{ status: string }>();
    expect(stored).toEqual({ status: "booting" });
  });

  test("only the first dispatch acquire can continue a run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, { id: ACTIVE_TRANSITION_RUN_ID, status: "queued" });

    const first = await acquireSessionRunDispatch(database, ACTIVE_TRANSITION_RUN_ID);
    const second = await acquireSessionRunDispatch(database, ACTIVE_TRANSITION_RUN_ID);

    expect(first?.id).toBe(ACTIVE_TRANSITION_RUN_ID);
    expect(first?.status).toBe("booting");
    expect(second).toBeNull();

    const stored = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(ACTIVE_TRANSITION_RUN_ID)
      .first<{ status: string }>();
    expect(stored).toEqual({ status: "booting" });
  });
});
