import { describe, expect, test } from "bun:test";

import {
  confirmCliOAuthDeviceFlow,
  pollCliOAuthDeviceToken,
  startCliOAuthDeviceFlow,
} from "../src/modules/auth/application/cli-oauth-device.service";
import { authenticatePersonalAccessToken } from "../src/modules/auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function createCliOAuthDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      email_verified integer NOT NULL,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE personal_access_token (
      id text PRIMARY KEY NOT NULL,
      account_id text NOT NULL,
      label text NOT NULL,
      token_hash text NOT NULL,
      last_used_at integer,
      revoked_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE cli_oauth_flow (
      id text PRIMARY KEY NOT NULL,
      account_id text,
      authorized_at integer,
      completed_at integer,
      created_at integer NOT NULL,
      device_code_hash text NOT NULL,
      expires_at integer NOT NULL,
      hostname text,
      provider text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      user_code text NOT NULL
    );

    CREATE UNIQUE INDEX cli_oauth_flow_device_code_hash_idx
      ON cli_oauth_flow (device_code_hash);
    CREATE UNIQUE INDEX cli_oauth_flow_user_code_idx
      ON cli_oauth_flow (user_code);

    INSERT INTO account (
      id,
      email,
      email_verified,
      image_url,
      last_active_organization_id,
      name,
      system_agent_model,
      created_at,
      updated_at
    )
    VALUES ('01J00000000000000000000001', 'owner@example.com', 1, NULL, NULL, 'Owner', NULL, 1, 1);
  `);

  return database;
}

describe("CLI OAuth device flow", () => {
  test("exchanges a confirmed browser session for a personal access token", async () => {
    const database = createCliOAuthDatabase();
    const start = await startCliOAuthDeviceFlow(database, {
      hostname: "http://localhost:8787/api",
      provider: "google",
      webOrigin: "http://localhost:5173",
    });

    expect(start.device_code).toStartWith("cli_");
    expect(start.user_code).toContain("-");
    expect(start.verification_uri).toBe("http://localhost:5173/cli-auth");
    expect(start.verification_uri_complete).toContain(
      `/cli-auth?code=${encodeURIComponent(start.user_code)}`,
    );

    const pending = await pollCliOAuthDeviceToken(database, {
      device_code: start.device_code,
    });
    expect(pending.status).toBe("pending");

    const confirmed = await confirmCliOAuthDeviceFlow(database, VIEWER, {
      user_code: start.user_code.replace("-", ""),
    });
    expect(confirmed.status).toBe("authorized");
    expect(confirmed.user_code).toBe(start.user_code);

    const token = await pollCliOAuthDeviceToken(database, {
      device_code: start.device_code,
    });
    expect(token.status).toBe("authorized");
    expect(token.access_token).toStartWith("mst_");
    expect(token.user?.email).toBe("owner@example.com");

    const caller = await authenticatePersonalAccessToken(database, token.access_token ?? "");
    expect(caller?.viewer.id).toBe(VIEWER.id);

    const consumed = await pollCliOAuthDeviceToken(database, {
      device_code: start.device_code,
    });
    expect(consumed).toEqual({ status: "consumed" });
  });

  test("rejects unsupported providers", async () => {
    const database = createCliOAuthDatabase();

    await expect(
      startCliOAuthDeviceFlow(database, {
        provider: "github",
        webOrigin: "http://localhost:5173",
      }),
    ).rejects.toThrow("supports google only");
  });
});
