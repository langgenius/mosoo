import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { setActiveOrganization } from "../src/modules/organizations/application/organization.service";
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
      join_policy text NOT NULL,
      primary_domain text,
      avatar_url text,
      creator_account_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      created_at integer NOT NULL,
      joined_at integer NOT NULL,
      PRIMARY KEY (organization_id, account_id)
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
      join_policy,
      primary_domain,
      avatar_url,
      creator_account_id,
      created_at,
      updated_at
    )
    VALUES
      ('01J00000000000000000000006', 'First Org', 'first-org', 'auto', NULL, NULL, 'account-1', 1, 1),
      ('org-2', 'Second Org', 'second-org', 'auto', NULL, NULL, 'account-1', 2, 2);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES
      ('01J00000000000000000000006', 'account-1', 'owner', NULL, NULL, 1, 1000),
      ('org-2', 'account-1', 'member', NULL, NULL, 2, 2000);

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

  test("builds the viewer payload with memberships", async () => {
    const database = createViewerContextDatabase();

    const viewer = await getViewer(database, {} as ApiBindings, VIEWER);

    expect(viewer.activeOrganization?.id).toBe("01J00000000000000000000006");
    expect(viewer.memberships.map((membership) => membership.organization.id)).toEqual([
      "org-2",
      "01J00000000000000000000006",
    ]);
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

  test("switches active organization", async () => {
    const database = createViewerContextDatabase();

    const summary = await setActiveOrganization(database, VIEWER, {
      organizationId: "org-2",
    });

    expect(summary).toMatchObject({
      id: "org-2",
      name: "Second Org",
      viewerRole: "member",
    });

    const account = await database
      .prepare("SELECT last_active_organization_id FROM account WHERE id = 'account-1'")
      .first<{ last_active_organization_id: string | null }>();

    expect(account?.last_active_organization_id).toBe("org-2");
  });
});
