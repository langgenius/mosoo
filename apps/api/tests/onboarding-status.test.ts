import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getOnboardingStatus } from "../src/modules/onboarding/application/onboarding.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};

function createOnboardingStatusDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE organization (
      avatar_url text,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL,
      kind text NOT NULL,
      name text NOT NULL,
      primary_domain text,
      slug text NOT NULL
    );

    CREATE TABLE organization_member (
      account_id text NOT NULL,
      disabled_at integer,
      joined_at integer NOT NULL,
      organization_id text NOT NULL,
      role text NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    INSERT INTO organization (
      avatar_url,
      created_at,
      id,
      join_policy,
      kind,
      name,
      primary_domain,
      slug
    )
    VALUES
      (NULL, 1, 'org-old', 'invite_only', 'team', 'Old Org', NULL, 'old-org'),
      (NULL, 2, 'org-current', 'auto', 'team', 'Current Org', NULL, 'current-org'),
      (NULL, 3, 'org-disabled', 'auto', 'team', 'Disabled Org', NULL, 'disabled-org');

    INSERT INTO organization_member (
      account_id,
      disabled_at,
      joined_at,
      organization_id,
      role
    )
    VALUES
      ('viewer-1', NULL, 10, 'org-old', 'member'),
      ('viewer-1', NULL, 20, 'org-current', 'admin'),
      ('viewer-1', 30, 30, 'org-disabled', 'member');
  `);

  return database;
}

describe("onboarding status", () => {
  test("loads only the latest active organization summary", async () => {
    const database = createOnboardingStatusDatabase();

    const status = await getOnboardingStatus(database, VIEWER);

    expect(status.completed).toBe(true);
    expect(status.organization?.id).toBe("org-current");
    expect(status.organization?.viewerRole).toBe("admin");
  });
});
