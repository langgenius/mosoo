import { appsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { getAppRow } from "../../apps/application/app.service";
import { SYSTEM_DEFAULT_NAME } from "./environment-config-mapping";
import { createEnvironmentFromConfig } from "./environment-write.service";

interface CreateAppEnvironmentDefaultsInput {
  actorId: AccountId | null;
  appId: AppId;
  timestampMs?: number;
}

async function createBuiltInEnvironment(
  bindings: Pick<ApiBindings, "DB">,
  input: Required<CreateAppEnvironmentDefaultsInput>,
): Promise<EnvironmentId> {
  const environmentId = createPlatformId<EnvironmentId>();

  await createEnvironmentFromConfig(bindings, {
    actorId: input.actorId,
    config: {
      allowMcpServers: true,
      allowPackageManagers: true,
      allowedHosts: [],
      envVars: [],
      networkPolicy: "full",
      packages: [],
      setupScript: "",
    },
    description: "",
    environmentId,
    name: SYSTEM_DEFAULT_NAME,
    ownerId: null,
    appId: input.appId,
    timestampMs: input.timestampMs,
  });

  return environmentId;
}

export async function createAppEnvironmentDefaults(
  bindings: Pick<ApiBindings, "DB">,
  input: CreateAppEnvironmentDefaultsInput,
): Promise<EnvironmentId> {
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const environmentId = await createBuiltInEnvironment(bindings, {
    actorId: input.actorId,
    appId: input.appId,
    timestampMs,
  });

  await getAppDatabase(bindings.DB)
    .update(appsTable)
    .set({
      defaultEnvironmentId: environmentId,
      updatedAt: timestampMs,
    })
    .where(eq(appsTable.id, input.appId))
    .run();

  return environmentId;
}

export async function getAppDefaultEnvironmentId(
  database: D1Database,
  appId: AppId,
): Promise<EnvironmentId> {
  const app = await getAppRow(database, appId);

  if (app.defaultEnvironmentId === null) {
    throw new Error("App default Environment is not configured.");
  }

  return app.defaultEnvironmentId;
}
