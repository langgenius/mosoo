import { expect, spyOn, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { SessionId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { validateThoughtEvents } from "../src/modules/runtime/infrastructure/driver-instance/thought-event-validation";
import {
  createPublicHttpContractDatabase,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import { insertRuntimeEvent } from "./public-thread-api-fixtures";

test("looks up new and existing thoughts through the session thought index", async () => {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  const sessionId = parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "session id");
  await insertRuntimeEvent(database, {
    kind: "thought.updated",
    occurredAt: 1,
    payload: { thoughtId: "existing", content: "first", offset: 0 },
    seq: 1,
    sessionId,
  });

  const plans: Promise<D1Result<{ detail: string }>>[] = [];
  const prepare = database.prepare.bind(database);
  const prepareSpy = spyOn(database, "prepare").mockImplementation((query) => {
    const statement = prepare(query);
    if (!query.includes("sum(CASE WHEN")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      plans.push(
        prepare(`EXPLAIN QUERY PLAN ${query}`)
          .bind(...values)
          .all<{ detail: string }>(),
      );
      return bind(...values);
    };
    return statement;
  });

  try {
    for (const thoughtId of ["new", "existing"]) {
      await validateThoughtEvents(database, {
        sessionId,
        events: [
          createRuntimeEvent({
            id: "00000000000000000000000002",
            kind: "thought.updated",
            occurredAt: new Date(2).toISOString(),
            payload: { thoughtId, content: "next", offset: thoughtId === "new" ? 0 : 5 },
            sessionId,
          }),
        ],
      });
    }
    expect(plans).toHaveLength(2);
    for (const plan of await Promise.all(plans)) {
      expect(plan.results.map((row) => row.detail).join("\n")).toContain(
        "USING INDEX session_event_session_thought_idx (session_id=? AND <expr>=?)",
      );
    }
  } finally {
    prepareSpy.mockRestore();
  }
});
