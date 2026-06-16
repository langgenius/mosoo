import type { AppSummary } from "@mosoo/contracts/app";
import { appsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AppId, OrganizationId } from "@mosoo/id";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAppEnvironmentDefaults } from "../../environments/application/environment.service";
import { ensureOrganizationOwnership } from "../../organizations/domain/organization-ownership.policy";
import { normalizeAppName } from "./app-defaults";
import { getAppRow, toAppSummary } from "./app.service";

interface CreateAppInput {
  name: string;
  organizationId: OrganizationId;
}

// Creates an additional App inside an organization the viewer owns. Mirrors the
// onboarding default-App provisioning (insert App row + default Environment).
// Kept out of app.service to avoid an apps <-> environments cycle.
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

  await getAppDatabase(database)
    .insert(appsTable)
    .values({
      createdAt: timestampMs,
      id: appId,
      name,
      organizationId: input.organizationId,
      ownerAccountId: viewer.id,
      updatedAt: timestampMs,
    })
    .run();

  await createAppEnvironmentDefaults({ DB: database }, { actorId: viewer.id, appId, timestampMs });

  return toAppSummary(await getAppRow(database, appId));
}
