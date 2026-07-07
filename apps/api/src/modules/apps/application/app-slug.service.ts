/**
 * App slug minting (PRD "API Namespace & Access").
 *
 * `ensureAppSlug` runs inside the native deploy branch on every
 * green-validated protocol deploy: the first one mints the slug from the App
 * name, every later one is a no-op read. Uniqueness is owned by the partial
 * unique index `app_slug_idx` (WHERE slug IS NOT NULL) — the mint loop simply
 * retries with the next `-2`, `-3`, … candidate when the guarded UPDATE hits
 * the index. The `slug IS NULL` guard doubles as the immutability latch: a
 * concurrent minter or an already-minted row makes the UPDATE a no-op, and
 * the winning slug is re-read instead of overwritten.
 */
import { appsTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { buildAppSlugBase, buildAppSlugCandidate } from "../domain/app-slug";
import { getAppRow } from "./app.service";

/**
 * Collision-retry bound. Suffixes are minted sequentially, so this only
 * limits pathological hot spots of identically named Apps; exhaustion throws
 * and terminal-fails the deploy run via the native branch's catch-all.
 */
const APP_SLUG_MINT_MAX_ATTEMPTS = 50;

/**
 * Returns the App's namespace slug, minting it from the App name when this
 * is the first protocol deploy. Never rewrites an existing slug.
 */
export async function ensureAppSlug(database: D1Database, appId: AppId): Promise<string> {
  const app = await getAppRow(database, appId);

  if (app.slug !== null) {
    return app.slug;
  }

  const base = buildAppSlugBase(app.name);

  for (let attempt = 1; attempt <= APP_SLUG_MINT_MAX_ATTEMPTS; attempt += 1) {
    const candidate = buildAppSlugCandidate(base, attempt);
    let changeCount: number;

    try {
      const update = await getAppDatabase(database)
        .update(appsTable)
        .set({ slug: candidate, updatedAt: currentTimestampMs() })
        .where(and(eq(appsTable.id, appId), isNull(appsTable.slug)))
        .run();

      changeCount = getD1ChangeCount(update);
    } catch (error) {
      if (isAppSlugUniqueConflict(error)) {
        continue;
      }

      throw error;
    }

    if (changeCount > 0) {
      return candidate;
    }

    // The guarded UPDATE matched no row: a concurrent deploy won the mint.
    const winner = await getAppRow(database, appId);

    if (winner.slug !== null) {
      return winner.slug;
    }

    throw new Error("App slug mint found no existing slug after a lost update.");
  }

  throw new Error(
    `App slug mint exhausted ${APP_SLUG_MINT_MAX_ATTEMPTS} candidates for base "${base}".`,
  );
}

/**
 * SQLite reports partial-unique-index hits as
 * `UNIQUE constraint failed: app.slug` (D1 wraps the same message), which is
 * what the retry loop keys on; anything else re-throws.
 */
function isAppSlugUniqueConflict(error: unknown): boolean {
  for (
    let current: unknown = error;
    current instanceof Error;
    current = (current as { cause?: unknown }).cause
  ) {
    if (
      current.message.includes("UNIQUE constraint failed") &&
      current.message.includes("app.slug")
    ) {
      return true;
    }
  }

  return false;
}
