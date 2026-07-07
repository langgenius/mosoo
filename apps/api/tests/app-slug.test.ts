/**
 * App namespace slug minting contract (PRD "API Namespace & Access", Open
 * Decision 1 as adopted): kebab base from the App NAME with documented
 * edges, `-2`/`-3` collision suffixes walked through real partial-unique
 * -index conflicts, and immutability once set — renameApp never re-mints.
 * The executor-level "first protocol deploy only" gate is pinned in
 * native-deployment-executor.test.ts; these tests own the mint mechanics.
 */
import { describe, expect, test } from "bun:test";

import { appsTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";

import { ensureAppSlug } from "../src/modules/apps/application/app-slug.service";
import { renameApp } from "../src/modules/apps/application/app.service";
import {
  APP_SLUG_MAX_BASE_LENGTH,
  buildAppSlugBase,
  buildAppSlugCandidate,
} from "../src/modules/apps/domain/app-slug";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import { OWNER_VIEWER } from "./public-thread-api-fixtures";

const FIXTURE_APP_ID = PUBLIC_API_TEST_IDS.app as AppId;
const SECOND_APP_ID = "01J000000000000000000000H1" as AppId;
const THIRD_APP_ID = "01J000000000000000000000H2" as AppId;

async function seedApp(database: SqliteD1Database, id: AppId, name: string): Promise<void> {
  await database
    .app()
    .insert(appsTable)
    .values({
      createdAt: nowMsForTest(),
      defaultEnvironmentId: null,
      id,
      name,
      organizationId: PUBLIC_API_TEST_IDS.organization,
      ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      updatedAt: nowMsForTest(),
    })
    .run();
}

async function readAppSlug(database: SqliteD1Database, appId: AppId): Promise<string | null> {
  const row = await database
    .prepare("SELECT slug FROM app WHERE id = ?")
    .bind(appId)
    .first<{ slug: string | null }>();

  return row?.slug ?? null;
}

describe("app slug minting", () => {
  test("kebab-normalizes app names into slug bases with the documented edges", () => {
    expect(buildAppSlugBase("Default App")).toBe("default-app");
    expect(buildAppSlugBase("  Cat Quiz!!  ")).toBe("cat-quiz");
    expect(buildAppSlugBase("Roadmap_Kanban v2")).toBe("roadmap-kanban-v2");

    // Names that normalize to nothing fall back to the "app" base; the
    // collision suffix then provides uniqueness.
    expect(buildAppSlugBase("猫のクイズ")).toBe("app");
    expect(buildAppSlugBase("---")).toBe("app");

    // The 48-character cap re-trims any hyphen the slice exposes.
    expect(buildAppSlugBase("a".repeat(60))).toBe("a".repeat(APP_SLUG_MAX_BASE_LENGTH));
    expect(buildAppSlugBase(`${"a".repeat(47)} b`)).toBe("a".repeat(47));

    expect(buildAppSlugCandidate("cat-quiz", 1)).toBe("cat-quiz");
    expect(buildAppSlugCandidate("cat-quiz", 2)).toBe("cat-quiz-2");
    expect(buildAppSlugCandidate("cat-quiz", 3)).toBe("cat-quiz-3");
  });

  test("mints once, stays idempotent, and never re-mints after renameApp", async () => {
    const database = await createPublicHttpContractDatabase();

    expect(await readAppSlug(database, FIXTURE_APP_ID)).toBeNull();
    await expect(ensureAppSlug(database, FIXTURE_APP_ID)).resolves.toBe("default-app");
    expect(await readAppSlug(database, FIXTURE_APP_ID)).toBe("default-app");

    // Re-running the mint is a no-op read of the immutable value.
    await expect(ensureAppSlug(database, FIXTURE_APP_ID)).resolves.toBe("default-app");

    // The slug is the API compatibility promise: renaming the App neither
    // rewrites it nor lets a later ensureAppSlug re-mint from the new name.
    const renamed = await renameApp(database, OWNER_VIEWER, {
      appId: FIXTURE_APP_ID,
      name: "Totally Different Name",
    });
    expect(renamed.slug).toBe("default-app");
    await expect(ensureAppSlug(database, FIXTURE_APP_ID)).resolves.toBe("default-app");
    expect(await readAppSlug(database, FIXTURE_APP_ID)).toBe("default-app");
  });

  test("walks -2/-3 suffixes through real unique-index conflicts", async () => {
    const database = await createPublicHttpContractDatabase();
    await seedApp(database, SECOND_APP_ID, "Default App");
    await seedApp(database, THIRD_APP_ID, "Default App");

    await expect(ensureAppSlug(database, FIXTURE_APP_ID)).resolves.toBe("default-app");
    await expect(ensureAppSlug(database, SECOND_APP_ID)).resolves.toBe("default-app-2");
    await expect(ensureAppSlug(database, THIRD_APP_ID)).resolves.toBe("default-app-3");

    expect(await readAppSlug(database, SECOND_APP_ID)).toBe("default-app-2");
    expect(await readAppSlug(database, THIRD_APP_ID)).toBe("default-app-3");

    // The suffixed slugs are immutable too.
    await expect(ensureAppSlug(database, SECOND_APP_ID)).resolves.toBe("default-app-2");
  });
});
