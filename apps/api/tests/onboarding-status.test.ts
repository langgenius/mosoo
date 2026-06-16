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
	      creator_account_id text,
	      id text PRIMARY KEY NOT NULL,
	      name text NOT NULL,
	      updated_at integer NOT NULL
	    );

    INSERT INTO organization (
	      avatar_url,
	      created_at,
	      creator_account_id,
	      id,
	      name,
	      updated_at
	    )
	    VALUES
	      (NULL, 1, 'viewer-1', 'org-old', 'Old Org', 1),
	      (NULL, 2, 'viewer-1', 'org-current', 'Current Org', 2),
	      (NULL, 3, 'other-owner', 'org-other-owner', 'Other Owner Org', 3);
  `);

  return database;
}

describe("onboarding status", () => {
  test("loads only the latest active organization summary", async () => {
    const database = createOnboardingStatusDatabase();

    const status = await getOnboardingStatus(database, VIEWER);

    expect(status.completed).toBe(true);
    expect(status.organization?.id).toBe("org-current");
    expect(status.organization).not.toHaveProperty("viewerRole");
  });
});
