import { environmentRevisionsTable } from "@mosoo/db";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { ensureEnvironmentAccess } from "./environment-access.service";
import { decryptEnvironmentVariables, parsePackagesJson } from "./environment-config";
import { toConfig } from "./environment-config-mapping";
import { getAppDefaultEnvironmentId } from "./environment-defaults";
import type { EnvironmentRecordRow } from "./environment-types";

export async function resolveEnvironmentSetupScriptForExecution(
  database: D1Database,
  input: {
    packagesJson: string;
    revisionId: EnvironmentRevisionId;
    setupScript: string;
  },
): Promise<string> {
  if (!parsePackagesJson(input.packagesJson).some((entry) => entry.packages.length > 0)) {
    return input.setupScript;
  }

  const row = await getAppDatabase(database)
    .select({ setupScript: environmentRevisionsTable.setupScript })
    .from(environmentRevisionsTable)
    .where(eq(environmentRevisionsTable.id, input.revisionId))
    .limit(1)
    .get();

  if (!row) {
    throw new Error("Session Environment revision is unavailable.");
  }

  return row.setupScript;
}

async function resolveAgentEnvironmentRecord(
  bindings: ApiBindings,
  input: {
    agentEnvironmentId: EnvironmentId | null;
    agentOwnerId: AccountId;
    appId: AppId;
  },
): Promise<EnvironmentRecordRow> {
  const environmentId =
    input.agentEnvironmentId ?? (await getAppDefaultEnvironmentId(bindings.DB, input.appId));
  const access = await ensureEnvironmentAccess(bindings.DB, input.agentOwnerId, {
    environmentId,
    appId: input.appId,
  });

  return access.row;
}

export async function resolveAgentEnvironmentSnapshot(
  bindings: ApiBindings,
  input: {
    agentEnvironmentId: EnvironmentId | null;
    agentOwnerId: AccountId;
    appId: AppId;
  },
): Promise<{
  envVars: Record<string, string>;
  name: string;
  record: EnvironmentRecordRow;
  setupScript: string;
}> {
  const row = await resolveAgentEnvironmentRecord(bindings, input);
  const config = toConfig(row);
  const envVars = await decryptEnvironmentVariables(bindings, {
    environmentId: row.id,
    envVars: config.envVars,
  });

  return {
    envVars,
    name: row.name,
    record: row,
    setupScript: config.setupScript,
  };
}
