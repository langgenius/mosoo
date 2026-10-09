import { environmentRevisionsTable } from "@mosoo/db";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, ProjectId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { ensureEnvironmentAccess } from "./environment-access.service";
import { parsePackagesJson } from "./environment-config";
import { getProjectDefaultEnvironmentId } from "./environment-defaults";
import type { EnvironmentRecordRow } from "./environment-types";

// Sessions admitted before package artifacts froze package install lines into
// their snapshot setup script, while their revision keeps only the custom
// script; running the revision's script keeps them from installing packages at
// runtime. Newer snapshots equal their revision, so a revision deleted with its
// Environment falls back to the snapshot.
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

  return row?.setupScript ?? input.setupScript;
}

export async function resolveAgentEnvironmentRecord(
  database: D1Database,
  input: {
    agentEnvironmentId: EnvironmentId | null;
    agentOwnerId: AccountId;
    projectId: ProjectId;
  },
): Promise<EnvironmentRecordRow> {
  const environmentId =
    input.agentEnvironmentId ?? (await getProjectDefaultEnvironmentId(database, input.projectId));
  const access = await ensureEnvironmentAccess(database, input.agentOwnerId, {
    environmentId,
    projectId: input.projectId,
  });

  return access.row;
}
