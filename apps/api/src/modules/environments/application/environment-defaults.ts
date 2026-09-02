import { projectsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, ProjectId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { getProjectRow } from "../../projects/application/project.service";
import { SYSTEM_DEFAULT_NAME } from "./environment-config-mapping";
import { createEnvironmentFromConfig } from "./environment-write.service";

interface CreateProjectEnvironmentDefaultsInput {
  actorId: AccountId | null;
  projectId: ProjectId;
  timestampMs?: number;
}

async function createBuiltInEnvironment(
  bindings: Pick<ApiBindings, "DB">,
  input: Required<CreateProjectEnvironmentDefaultsInput>,
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
    projectId: input.projectId,
    timestampMs: input.timestampMs,
  });

  return environmentId;
}

export async function createProjectEnvironmentDefaults(
  bindings: Pick<ApiBindings, "DB">,
  input: CreateProjectEnvironmentDefaultsInput,
): Promise<EnvironmentId> {
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const environmentId = await createBuiltInEnvironment(bindings, {
    actorId: input.actorId,
    projectId: input.projectId,
    timestampMs,
  });

  await getAppDatabase(bindings.DB)
    .update(projectsTable)
    .set({
      defaultEnvironmentId: environmentId,
      updatedAt: timestampMs,
    })
    .where(eq(projectsTable.id, input.projectId))
    .run();

  return environmentId;
}

export async function getProjectDefaultEnvironmentId(
  database: D1Database,
  projectId: ProjectId,
): Promise<EnvironmentId> {
  const project = await getProjectRow(database, projectId);

  if (project.defaultEnvironmentId === null) {
    throw new Error("Project default Environment is not configured.");
  }

  return project.defaultEnvironmentId;
}
