import type { AccountId, EnvironmentId, AppId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureEnvironmentAccess } from "./environment-access.service";
import { decryptEnvironmentVariables, makePackageSetupScript } from "./environment-config";
import { toConfig } from "./environment-config-mapping";
import { getAppDefaultEnvironmentId } from "./environment-defaults";
import type { EnvironmentRecordRow } from "./environment-types";

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
  const packageSetupScript = makePackageSetupScript(config.packages);
  const setupScript = [packageSetupScript, config.setupScript].filter(Boolean).join("\n\n");

  return {
    envVars,
    name: row.name,
    record: row,
    setupScript,
  };
}
