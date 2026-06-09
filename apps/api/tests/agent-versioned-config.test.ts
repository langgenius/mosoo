import { describe, expect, test } from "bun:test";

import {
  evaluateAgentRuntimeSelection,
  listAgentSkillIds,
} from "../src/modules/agents/application/agent-versioned-config.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createAgentVersionedConfigDatabase(): D1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL
    );

    CREATE TABLE skill (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      current_snapshot_id text NOT NULL,
      owner_account_id text NOT NULL
    );

    CREATE TABLE agent_skill (
      agent_id text NOT NULL,
      skill_id text NOT NULL,
      sort_order integer NOT NULL,
      created_at integer NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );

    INSERT INTO account (id, name)
    VALUES ('01J00000000000000000000001', 'Alex Example');

    INSERT INTO skill (id, name, current_snapshot_id, owner_account_id)
    VALUES ('01J0000000000000000000006B', 'registry skill', '01J0000000000000000000006C', '01J00000000000000000000001');

    INSERT INTO agent_skill (agent_id, skill_id, sort_order, created_at)
    VALUES ('01J00000000000000000000009', '01J0000000000000000000006B', 0, 1);
  `);

  return database;
}

describe("agent versioned config", () => {
  test("keeps Runtime selection independent from model provider selection", () => {
    expect(
      evaluateAgentRuntimeSelection({
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        runtimeId: "openai-runtime",
      }),
    ).toEqual({
      ok: true,
      runtimeId: "openai-runtime",
    });
  });

  test("editable skill id snapshots exclude package-owned skill runtime ids", async () => {
    const skillIds = await listAgentSkillIds(
      createAgentVersionedConfigDatabase(),
      "01J00000000000000000000009",
    );

    expect(skillIds).toEqual(["01J0000000000000000000006B"]);
  });
});
