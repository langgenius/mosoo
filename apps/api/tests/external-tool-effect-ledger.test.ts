import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId } from "@mosoo/id";

import { DriverInstanceRpcExternalToolEffectController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-external-tool-effect-controller";
import {
  claimExternalToolEffect,
  observeExternalToolEffect,
  settleExternalToolEffect,
} from "../src/modules/runtime/infrastructure/session-runs/external-tool-effect.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const identity = {
  commandId: parsePlatformId<DriverCommandId>("01J00000000000000000000011"),
  connectionId: "connection-1",
  driverInstanceId: parsePlatformId<DriverInstanceId>("01J00000000000000000000009"),
};
const runId = "01J0000000000000000000000N";
const sessionId = "01J0000000000000000000000S";
const command = {
  argumentsJson: '{"amount":7}',
  commandId: identity.commandId,
  kind: "mcp.execute",
  requestId: "request-1",
  runId,
  serverId: "01J0000000000000000000000M",
  toolCallId: "tool-1",
  toolName: "write",
} as const;
const claimToken = "ba3eaa6b-84e8-4d75-b7f5-a44c64b0fa2d";
const otherClaimToken = "179a916a-c3e1-438b-a91b-21de3d345b37";
const claim = { ...identity, claimToken };
const result = {
  isError: false,
  outputText: "written",
  requestId: command.requestId,
  serverId: command.serverId,
  toolName: command.toolName,
};
const settlement = {
  kind: "succeeded",
  providerReceiptJson: '{"id":"receipt-1"}',
  result,
} as const;
const effectMigration = readFileSync(
  new URL("../../../pkgs/db/drizzle/0010_external-tool-effects.sql", import.meta.url),
  "utf8",
);

async function createDatabase(database = new SqliteD1Database()): Promise<SqliteD1Database> {
  database.execute(`
    CREATE TABLE driver_instance (
      id TEXT PRIMARY KEY, connection_id TEXT, sandbox_session_id TEXT, status TEXT
    );
    CREATE TABLE driver_command (
      id TEXT PRIMARY KEY, driver_instance_id TEXT, kind TEXT, payload_json TEXT, status TEXT
    );
    CREATE TABLE session_run (
      id TEXT PRIMARY KEY, driver_instance_id TEXT, session_id TEXT, status TEXT
    );
    INSERT INTO driver_instance VALUES (
      '${identity.driverInstanceId}', '${identity.connectionId}', '${sessionId}', 'ready'
    );
    INSERT INTO session_run VALUES ('${runId}', '${identity.driverInstanceId}', '${sessionId}', 'running');
  `);
  database.execute(effectMigration);
  database.execute("ALTER TABLE external_tool_effect_attempt ADD COLUMN claim_token TEXT");
  await database
    .prepare("INSERT INTO driver_command VALUES (?, ?, ?, ?, 'accepted')")
    .bind(command.commandId, identity.driverInstanceId, command.kind, JSON.stringify(command))
    .run();
  return database;
}

async function effectRows(database: SqliteD1Database) {
  return {
    attempts: (await database.prepare("SELECT * FROM external_tool_effect_attempt").all()).results,
    effects: (await database.prepare("SELECT * FROM external_tool_effect").all()).results,
  };
}

describe("durable external tool effects", () => {
  test("keeps one intent and one execution attempt across concurrent retries and restart", async () => {
    const database = await createDatabase();
    const [first, replay] = await Promise.all([
      observeExternalToolEffect(database, identity),
      observeExternalToolEffect(database, identity),
    ]);
    expect(first).toEqual(replay);
    expect(first.kind).toBe("intent");

    const claims = await Promise.all([
      claimExternalToolEffect(database, claim),
      claimExternalToolEffect(database, claim),
    ]);
    expect(claims[0]).toEqual(claims[1]);
    expect(claims[0]).toEqual({
      attempt: 1,
      effectId: first.effectId,
      idempotencyKey: first.effectId,
      kind: "claimed",
    });
    const restarted = new SqliteD1Database({ image: await database.dump() });
    expect(await claimExternalToolEffect(restarted, claim)).toEqual(claims[0]);
    const rows = await effectRows(restarted);
    expect(rows.effects).toHaveLength(1);
    expect(rows.attempts).toHaveLength(1);
    expect(rows.attempts[0]).toMatchObject({
      attempt: 1,
      claim_token: claimToken,
      status: "executing",
    });
  });

  test("never grants another execution token and persists uncertainty", async () => {
    const database = await createDatabase();
    const first = await claimExternalToolEffect(database, claim);
    expect(
      await claimExternalToolEffect(database, { ...claim, claimToken: otherClaimToken }),
    ).toEqual({ effectId: first.effectId, kind: "unknown" });
    expect(await claimExternalToolEffect(database, claim)).toEqual({
      effectId: first.effectId,
      kind: "unknown",
    });
    expect(
      await settleExternalToolEffect(database, { ...claim, effectId: first.effectId, settlement }),
    ).toEqual({ effectId: first.effectId, kind: "unknown" });
    const rows = await effectRows(database);
    expect(rows.attempts).toHaveLength(1);
    expect(rows.attempts[0]).toMatchObject({ attempt: 1, status: "unknown", result_json: null });
  });

  test("returns the first durable result after lost settlement acknowledgement", async () => {
    const database = await createDatabase();
    const first = await claimExternalToolEffect(database, claim);
    const input = { ...claim, effectId: first.effectId, settlement };
    const settled = await settleExternalToolEffect(database, input);
    expect(settled).toEqual({ effectId: first.effectId, kind: "succeeded", result });
    const restarted = new SqliteD1Database({ image: await database.dump() });
    expect(await settleExternalToolEffect(restarted, input)).toEqual(settled);
    expect(
      await settleExternalToolEffect(restarted, {
        ...input,
        settlement: { kind: "unknown" },
      }),
    ).toEqual(settled);
    expect(
      await claimExternalToolEffect(restarted, { ...claim, claimToken: otherClaimToken }),
    ).toEqual(settled);
    expect(await observeExternalToolEffect(restarted, identity)).toEqual(settled);
    const rows = await effectRows(restarted);
    expect(rows.attempts[0]).toMatchObject({
      status: "succeeded",
      provider_receipt_json: settlement.providerReceiptJson,
      result_json: JSON.stringify(result),
    });
  });

  test("persists unknown settlement and refuses later promotion to success", async () => {
    const database = await createDatabase();
    const first = await claimExternalToolEffect(database, claim);
    const input = { ...claim, effectId: first.effectId };
    await settleExternalToolEffect(database, { ...input, settlement: { kind: "unknown" } });
    const restarted = new SqliteD1Database({ image: await database.dump() });
    expect(await settleExternalToolEffect(restarted, { ...input, settlement })).toEqual({
      effectId: first.effectId,
      kind: "unknown",
    });
    expect((await effectRows(restarted)).attempts[0]).toMatchObject({ status: "unknown" });
  });

  test("checks effect and result identity before accepting a settlement", async () => {
    const database = await createDatabase();
    const first = await claimExternalToolEffect(database, claim);
    await expect(
      settleExternalToolEffect(database, { ...claim, effectId: "wrong-effect", settlement }),
    ).rejects.toThrow();
    for (const field of ["requestId", "serverId", "toolName"] as const) {
      await expect(
        settleExternalToolEffect(database, {
          ...claim,
          effectId: first.effectId,
          settlement: { ...settlement, result: { ...result, [field]: "wrong" } },
        }),
      ).rejects.toThrow("does not match");
    }
    expect(await observeExternalToolEffect(database, identity)).toEqual(first);
    expect(
      await settleExternalToolEffect(database, {
        ...claim,
        claimToken: otherClaimToken,
        effectId: first.effectId,
        settlement,
      }),
    ).toEqual({ effectId: first.effectId, kind: "unknown" });
  });

  test("rejects claims from stale connections, foreign Runs, and inactive commands", async () => {
    for (const mutation of [
      "UPDATE driver_instance SET connection_id = 'replaced'",
      "UPDATE driver_instance SET status = 'stopping'",
      "UPDATE session_run SET driver_instance_id = 'another-driver'",
      "UPDATE session_run SET session_id = 'another-session'",
      "UPDATE session_run SET status = 'cancelled'",
      "UPDATE driver_command SET status = 'queued'",
      "UPDATE driver_command SET status = 'completed'",
      "UPDATE driver_command SET kind = 'input.start'",
      "UPDATE driver_command SET driver_instance_id = 'another-driver'",
    ]) {
      const database = await createDatabase();
      database.execute(mutation);
      await expect(claimExternalToolEffect(database, claim)).rejects.toThrow();
      expect(await effectRows(database)).toEqual({ attempts: [], effects: [] });
    }
  });

  test("fences a connection replaced between command read and transaction", async () => {
    class ReplacedConnectionDatabase extends SqliteD1Database {
      override async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
        this.execute("UPDATE driver_instance SET connection_id = 'replaced'");
        return super.batch<T>(statements);
      }
    }
    const database = await createDatabase(new ReplacedConnectionDatabase());
    await expect(claimExternalToolEffect(database, claim)).rejects.toThrow();
    expect(await effectRows(database)).toEqual({ attempts: [], effects: [] });
  });

  test("settles already invoked work after cancellation without authorizing another invocation", async () => {
    const database = await createDatabase();
    const first = await claimExternalToolEffect(database, claim);
    database.execute("UPDATE session_run SET status = 'cancelled'");
    database.execute("UPDATE driver_command SET status = 'cancelled'");
    await expect(claimExternalToolEffect(database, claim)).rejects.toThrow();
    expect(
      await settleExternalToolEffect(database, { ...claim, effectId: first.effectId, settlement }),
    ).toEqual({ effectId: first.effectId, kind: "succeeded", result });
  });

  test("rolls back the execution fence if its attempt cannot be persisted", async () => {
    const database = await createDatabase();
    const intent = await observeExternalToolEffect(database, identity);
    database.execute(`CREATE TRIGGER reject_attempt BEFORE INSERT ON external_tool_effect_attempt
      BEGIN SELECT RAISE(ABORT, 'injected attempt failure'); END`);
    await expect(claimExternalToolEffect(database, claim)).rejects.toThrow(
      "injected attempt failure",
    );
    expect(await observeExternalToolEffect(database, identity)).toEqual(intent);
    expect((await effectRows(database)).attempts).toEqual([]);
  });

  test("rolls back result settlement if the attempt cannot be settled", async () => {
    const database = await createDatabase();
    const first = await claimExternalToolEffect(database, claim);
    database.execute(`CREATE TRIGGER reject_settlement BEFORE UPDATE ON external_tool_effect_attempt
      BEGIN SELECT RAISE(ABORT, 'injected settlement failure'); END`);
    await expect(
      settleExternalToolEffect(database, { ...claim, effectId: first.effectId, settlement }),
    ).rejects.toThrow("injected settlement failure");
    expect(await observeExternalToolEffect(database, identity)).toEqual(first);
    expect((await effectRows(database)).attempts[0]).toMatchObject({ status: "executing" });
  });

  test("checks the live connection before responding and permits safe retry after a lost response", async () => {
    const database = await createDatabase();
    const state = { requireDriverInstanceId: () => identity.driverInstanceId, terminalized: false };
    const controller = new DriverInstanceRpcExternalToolEffectController({
      env: { DB: database },
      state,
    } as never);
    let assertions = 0;
    const context = {
      connectionId: identity.connectionId,
      driverInstanceId: identity.driverInstanceId,
      assertActiveConnection: () => {
        assertions += 1;
        if (assertions === 2) throw new Error("connection replaced");
      },
    };
    await expect(controller.handleClaim(claim, context)).rejects.toThrow("connection replaced");
    const retried = await controller.handleClaim(claim, context);
    expect(retried.kind).toBe("claimed");
    expect((await effectRows(database)).attempts).toHaveLength(1);
    await expect(
      controller.handleObserve({ ...identity, driverInstanceId: "another-driver" }, context),
    ).rejects.toThrow("Driver instance id mismatch");
    state.terminalized = true;
    await expect(controller.handleClaim(claim, context)).rejects.toThrow("Driver is closed");
  });
});
