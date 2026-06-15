import type { AppSummary } from "@mosoo/contracts/app";
import { appsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AppId, OrganizationId } from "@mosoo/id";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { errorMessageChainIncludes, validationError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAppEnvironmentDefaults } from "../../environments/application/environment.service";
import { ensureOrganizationOwnership } from "../../organizations/domain/organization-ownership.policy";
import { deriveAppSlugBase, normalizeAppName } from "./app-defaults";
import { getAppRow, toAppSummary } from "./app.service";

interface CreateAppInput {
  name: string;
  organizationId: OrganizationId;
}

const MAX_APP_SLUG_ATTEMPTS = 999;

function deriveAppSlugCandidate(slugBase: string, attempt: number): string {
  return attempt === 1 ? slugBase : `${slugBase}-${attempt}`;
}

function isAppSlugConflict(error: unknown): boolean {
  return errorMessageChainIncludes(error, ["app_organization_slug_idx", "app.slug"]);
}

// Creates an additional App inside an organization the viewer owns. Mirrors the
// onboarding default-App provisioning (insert App row + default Environment) but
// derives a unique slug from the supplied name instead of using the reserved
// "default" slug. Kept out of app.service to avoid an apps <-> environments cycle.
export async function createApp(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateAppInput,
): Promise<AppSummary> {
  await ensureOrganizationOwnership(database, viewer.id, input.organizationId);

  const name = normalizeAppName(input.name);

  if (name.length > 200) {
    throw validationError("App name is too long.");
  }

  const appId: AppId = createPlatformId();
  const timestampMs = currentTimestampMs();
  const slugBase = deriveAppSlugBase(name);
  let slug: string | null = null;

  for (let attempt = 1; attempt <= MAX_APP_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = deriveAppSlugCandidate(slugBase, attempt);

    try {
      await getAppDatabase(database)
        .insert(appsTable)
        .values({
          createdAt: timestampMs,
          id: appId,
          name,
          organizationId: input.organizationId,
          ownerAccountId: viewer.id,
          slug: candidate,
          updatedAt: timestampMs,
        })
        .run();
      slug = candidate;
      break;
    } catch (error) {
      if (isAppSlugConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  if (slug === null) {
    throw new Error("Could not allocate App slug.");
  }

  await createAppEnvironmentDefaults({ DB: database }, { actorId: viewer.id, appId, timestampMs });

  return toAppSummary(await getAppRow(database, appId));
}
