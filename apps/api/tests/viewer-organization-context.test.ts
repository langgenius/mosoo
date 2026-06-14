import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getViewer, updateProfile } from "../src/modules/users/application/viewer-context.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "account-1",
  imageUrl: null,
  name: "Viewer",
};

function createViewerContextDatabase(): SqliteD1Database {
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

	    CREATE TABLE organization (
	      id text PRIMARY KEY NOT NULL,
	      name text NOT NULL,
	      slug text NOT NULL,
	      avatar_url text,
	      creator_account_id text,
	      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

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
    VALUES ('account-1', 'viewer@example.com', 1, NULL, '01J00000000000000000000006', 'Viewer', NULL, 1, 1);

    INSERT INTO organization (
	      id,
	      name,
	      slug,
	      avatar_url,
	      creator_account_id,
	      created_at,
      updated_at
	    )
	    VALUES
	      ('01J00000000000000000000006', 'First Org', 'first-org', NULL, 'account-1', 1, 1),
	      ('org-2', 'Second Org', 'second-org', NULL, 'account-1', 2, 2),
	      ('org-other-owner', 'Other Owner Org', 'other-owner-org', NULL, 'other-owner', 3, 3);

  `);

  return database;
}

describe("viewer organization context", () => {
  test("returns an updated profile", async () => {
    const database = createViewerContextDatabase();

    const account = await updateProfile(database, VIEWER, {
      name: "Updated Viewer",
    });

    expect(account).toMatchObject({
      email: "viewer@example.com",
      id: "account-1",
      name: "Updated Viewer",
      systemAgentModel: null,
    });
  });

  test("updates the account image url", async () => {
    const database = createViewerContextDatabase();

    const account = await updateProfile(database, VIEWER, {
      imageUrl: "https://cdn.example.com/avatar.png",
      name: "Viewer",
    });

    expect(account.imageUrl).toBe("https://cdn.example.com/avatar.png");

    const stored = (await database
      .prepare("SELECT image_url FROM account WHERE id = ?")
      .bind("account-1")
      .first()) as { image_url: string | null } | null;
    expect(stored?.image_url).toBe("https://cdn.example.com/avatar.png");
  });

  test("clears the account image url when set to empty", async () => {
    const database = createViewerContextDatabase();
    database.execute(`
      UPDATE account SET image_url = 'https://cdn.example.com/old.png' WHERE id = 'account-1';
    `);

    const account = await updateProfile(
      database,
      { ...VIEWER, imageUrl: "https://cdn.example.com/old.png" },
      { imageUrl: "", name: "Viewer" },
    );

    expect(account.imageUrl).toBeNull();

    const stored = (await database
      .prepare("SELECT image_url FROM account WHERE id = ?")
      .bind("account-1")
      .first()) as { image_url: string | null } | null;
    expect(stored?.image_url).toBeNull();
  });

  test("rejects an invalid image url", async () => {
    const database = createViewerContextDatabase();

    await expect(
      updateProfile(database, VIEWER, { imageUrl: "javascript:alert(1)", name: "Viewer" }),
    ).rejects.toThrow();
  });

  test("leaves the image url untouched when not provided", async () => {
    const database = createViewerContextDatabase();
    database.execute(`
      UPDATE account SET image_url = 'https://cdn.example.com/keep.png' WHERE id = 'account-1';
    `);

    await updateProfile(
      database,
      { ...VIEWER, imageUrl: "https://cdn.example.com/keep.png" },
      { name: "Renamed" },
    );

    const stored = (await database
      .prepare("SELECT image_url, name FROM account WHERE id = ?")
      .bind("account-1")
      .first()) as { image_url: string | null; name: string } | null;
    expect(stored?.image_url).toBe("https://cdn.example.com/keep.png");
    expect(stored?.name).toBe("Renamed");
  });

  test("builds the viewer payload with owner organizations", async () => {
    const database = createViewerContextDatabase();

    const viewer = await getViewer(database, {} as ApiBindings, VIEWER);

    expect(viewer.activeOrganization?.id).toBe("01J00000000000000000000006");
    expect(viewer.organizations.map((organization) => organization.id)).toEqual([
      "org-2",
      "01J00000000000000000000006",
    ]);
    expect(viewer.organizations).not.toContainEqual(
      expect.objectContaining({ id: "org-other-owner" }),
    );
  });

  test("builds the viewer payload with account settings", async () => {
    const database = createViewerContextDatabase();
    database.execute(`
      UPDATE account
      SET system_agent_model = '{"vendor":"openai","modelId":"model-1"}'
      WHERE id = 'account-1';
    `);

    const viewer = await getViewer(database, {} as ApiBindings, VIEWER);

    expect(viewer.account?.systemAgentModel).toEqual({
      modelId: "model-1",
      vendor: "openai",
    });
  });

  test("reads the account name and image from the database, not the session", async () => {
    const database = createViewerContextDatabase();
    database.execute(`
      UPDATE account
      SET image_url = 'https://cdn.example.com/fresh.png', name = 'Fresh Name'
      WHERE id = 'account-1';
    `);

    // Session viewer is intentionally stale (e.g. better-auth cookie cache).
    const staleViewer = { ...VIEWER, imageUrl: null, name: "Stale Name" };
    const viewer = await getViewer(database, {} as ApiBindings, staleViewer);

    expect(viewer.account?.imageUrl).toBe("https://cdn.example.com/fresh.png");
    expect(viewer.account?.name).toBe("Fresh Name");
  });
});
