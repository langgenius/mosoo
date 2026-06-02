import { environmentsTable, organizationsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, OrganizationId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { getOrganizationDefaultsRow } from "./environment-access.service";
import { SYSTEM_DEFAULT_NAME } from "./environment-config-mapping";
import { createEnvironmentFromConfig } from "./environment-write.service";

interface CreateOrganizationEnvironmentDefaultsInput {
  actorId: AccountId | null;
  organizationId: OrganizationId;
  timestampMs?: number;
}

async function createBuiltInEnvironment(
  bindings: Pick<ApiBindings, "DB">,
  input: Required<CreateOrganizationEnvironmentDefaultsInput>,
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
    organizationId: input.organizationId,
    ownerId: null,
    timestampMs: input.timestampMs,
  });

  return environmentId;
}

export async function createOrganizationEnvironmentDefaults(
  bindings: Pick<ApiBindings, "DB">,
  input: CreateOrganizationEnvironmentDefaultsInput,
): Promise<EnvironmentId> {
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const environmentId = await createBuiltInEnvironment(bindings, {
    actorId: input.actorId,
    organizationId: input.organizationId,
    timestampMs,
  });

  await getAppDatabase(bindings.DB)
    .update(organizationsTable)
    .set({
      defaultEnvironmentId: environmentId,
      updatedAt: timestampMs,
    })
    .where(eq(organizationsTable.id, input.organizationId))
    .run();

  return environmentId;
}

export async function ensureOrganizationEnvironmentDefaults(
  bindings: Pick<ApiBindings, "DB">,
  organizationId: OrganizationId,
): Promise<EnvironmentId> {
  const organization = await getOrganizationDefaultsRow(bindings.DB, organizationId);
  const existingSystem =
    (await getAppDatabase(bindings.DB)
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.organizationId, organizationId),
          isNull(environmentsTable.ownerAccountId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  let systemEnvironmentId = existingSystem?.id ?? null;
  const timestampMs = currentTimestampMs();

  if (!isTruthy(systemEnvironmentId)) {
    systemEnvironmentId = await createBuiltInEnvironment(bindings, {
      actorId: organization.creatorAccountId,
      organizationId,
      timestampMs,
    });
  }

  if (!isTruthy(organization.defaultEnvironmentId)) {
    await getAppDatabase(bindings.DB)
      .update(organizationsTable)
      .set({
        defaultEnvironmentId: systemEnvironmentId,
        updatedAt: timestampMs,
      })
      .where(eq(organizationsTable.id, organizationId))
      .run();
  }

  return organization.defaultEnvironmentId ?? systemEnvironmentId;
}
