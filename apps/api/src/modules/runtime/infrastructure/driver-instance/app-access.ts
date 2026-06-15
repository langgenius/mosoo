import type { SpaceAliasBinding as SpaceAliasBindingValue } from "@mosoo/contracts/sandbox";
import { sandboxSessionsTable } from "@mosoo/db";
import type { AccountId, SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import type {
  RuntimeArtifactSummaryChange,
  RuntimeFileChangeInput,
} from "../runtime-space-file-changes";
import {
  deleteRuntimeSpaceFileRecord,
  upsertRuntimeSpaceFileRecord,
} from "../runtime-space-file-records";
import { isHiddenRuntimeSpacePath, resolveRuntimeSpacePath } from "../runtime-space-paths";
import { parseSandboxConversationSpaceAliases } from "../sandbox-session/sandbox-conversation-session-codec";

export interface RuntimeSessionAccessContext {
  executionOwnerUserId: AccountId | null;
  sessionId: SessionId | null;
}

function isNonEmptyString<TValue extends string>(value: TValue | null): value is TValue {
  return typeof value === "string" && value.length > 0;
}

function isRuntimeSessionAccessContextReady(context: RuntimeSessionAccessContext): context is {
  executionOwnerUserId: AccountId;
  sessionId: SessionId;
} {
  return isNonEmptyString(context.executionOwnerUserId) && isNonEmptyString(context.sessionId);
}

async function getSandboxSessionAliases(
  database: D1Database,
  sessionId: SessionId,
): Promise<SpaceAliasBindingValue[]> {
  const row =
    (await getAppDatabase(database)
      .select({ spaceAliasesJson: sandboxSessionsTable.spaceAliasesJson })
      .from(sandboxSessionsTable)
      .where(eq(sandboxSessionsTable.sessionId, sessionId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return [];
  }

  return parseSandboxConversationSpaceAliases(row.spaceAliasesJson);
}

export async function indexRuntimeSpaceFileMutation(
  database: D1Database,
  context: RuntimeSessionAccessContext,
  fileChange: RuntimeFileChangeInput,
): Promise<RuntimeArtifactSummaryChange> {
  if (!isRuntimeSessionAccessContextReady(context)) {
    return null;
  }

  const aliases = await getSandboxSessionAliases(database, context.sessionId);
  const resolved = resolveRuntimeSpacePath(aliases, fileChange.path);

  if (resolved === null || resolved.relativePath.length === 0) {
    return null;
  }

  if (isHiddenRuntimeSpacePath(resolved.relativePath)) {
    return null;
  }

  if (fileChange.change === "delete") {
    return (await deleteRuntimeSpaceFileRecord(database, resolved)).artifactChange;
  }

  const size = typeof fileChange.metadata?.["size"] === "number" ? fileChange.metadata["size"] : 0;
  const result = await upsertRuntimeSpaceFileRecord({
    database,
    ownerUserId: context.executionOwnerUserId,
    resolution: resolved,
    size,
  });

  return result.artifactChange;
}
