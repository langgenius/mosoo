import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import { sandboxSessionsTable, sessionsTable } from "@mosoo/db";
import {
  SANDBOX_GLOBAL_SPACE_ROOT,
  SANDBOX_MEMORY_PATH,
  SANDBOX_ORGANIZATION_ROOT,
  SANDBOX_SESSION_ROOT,
  SANDBOX_WORKSPACE_ROOT,
} from "@mosoo/driver-protocol";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, SandboxId, SessionId, SpaceId } from "@mosoo/id";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import { listSpaceAccessRows } from "../../spaces/domain/space-access.policy";
import { parseSandboxConversationSpaceAliases } from "../infrastructure/sandbox-session/sandbox-conversation-session-codec";
import { toDirectoryEntry } from "./agent-file-browser-listing";
import type {
  AgentFileEntry,
  AgentFileSandboxStatus,
  AgentFileTree,
  AgentFileTreeListingEntry,
  ListingParseResult,
} from "./agent-file-browser-model";
import type { AgentFileBrowserSandboxRecord } from "./agent-file-browser-target.service";

async function getSandboxSessionEntries(
  database: D1Database,
  sandboxId: SandboxId,
): Promise<AgentFileTreeListingEntry[]> {
  const rows = await getAppDatabase(database)
    .select({
      sandboxSessionStatus: sql`${sandboxSessionsTable.status}`
        .mapWith(sandboxSessionsTable.status)
        .as("sandboxSessionStatus"),
      sessionId: sessionsTable.id,
      sessionStatus: sql`${sessionsTable.status}`.mapWith(sessionsTable.status).as("sessionStatus"),
      title: sessionsTable.title,
      updatedAt: sessionsTable.updatedAt,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, sandboxId),
        inArray(sandboxSessionsTable.status, ["active", "closed"]),
        isNull(sessionsTable.archivedAt),
      ),
    )
    .orderBy(desc(sessionsTable.updatedAt))
    .all();

  return rows
    .filter((row) => row.sessionStatus !== "TERMINATED")
    .map((row) => {
      const path = `${SANDBOX_SESSION_ROOT}/${row.sessionId}`;
      const entry = toDirectoryEntry({
        name: row.sessionId,
        path,
        persistence: "temporary",
      });

      entry.session = {
        active: row.sandboxSessionStatus === "active",
        id: row.sessionId,
        status: row.sessionStatus,
        title: row.title,
        updatedAt: toIsoString(row.updatedAt),
      };

      return entry;
    });
}

async function listSandboxSpaceAliases(
  database: D1Database,
  sandboxId: SandboxId,
  viewerId: AccountId,
): Promise<SpaceAliasBinding[]> {
  const rows = await getAppDatabase(database)
    .select({
      sessionStatus: sessionsTable.status,
      spaceAliasesJson: sandboxSessionsTable.spaceAliasesJson,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, sandboxId),
        inArray(sandboxSessionsTable.status, ["active", "closed"]),
        isNull(sessionsTable.archivedAt),
      ),
    )
    .all();

  const aliasesBySpaceId = new Map<SpaceId, SpaceAliasBinding>();

  for (const row of rows) {
    if (row.sessionStatus === "TERMINATED") {
      continue;
    }

    for (const alias of parseSandboxConversationSpaceAliases(row.spaceAliasesJson)) {
      aliasesBySpaceId.set(alias.spaceId, alias);
    }
  }

  const aliases = [...aliasesBySpaceId.values()];
  const access = await listSpaceAccessRows(
    database,
    viewerId,
    aliases.map((alias) => alias.spaceId),
  );

  return aliases
    .filter((alias) => access.accessibleRowsById.has(alias.spaceId))
    .toSorted((left, right) => left.spaceName.localeCompare(right.spaceName));
}

async function getSandboxSpaceEntries(
  database: D1Database,
  viewerId: AccountId,
  sandboxId: SandboxId,
): Promise<AgentFileTreeListingEntry[]> {
  const aliases = await listSandboxSpaceAliases(database, sandboxId, viewerId);

  return aliases.map((alias) => {
    const path = alias.globalMountPath;

    return {
      kind: "space_mount",
      mimeType: null,
      name: alias.spaceName,
      path,
      persistence: "persistent",
      preview: "binary",
      sizeBytes: 0,
      space: {
        path,
        spaceId: alias.spaceId,
        spaceName: alias.spaceName,
        url: `/space?space=${encodeURIComponent(alias.spaceId)}`,
      },
    };
  });
}

function getSessionIdFromAgentFilePath(path: string): SessionId | null {
  if (!path.startsWith(`${SANDBOX_SESSION_ROOT}/`)) {
    return null;
  }

  const sessionId = path.slice(SANDBOX_SESSION_ROOT.length + 1).split("/")[0];
  return sessionId === undefined ? null : parsePlatformId(sessionId, "session path id");
}

function getSpaceMountPathFromAgentFilePath(path: string): string | null {
  return path.startsWith(`${SANDBOX_GLOBAL_SPACE_ROOT}/`) ? path : null;
}

async function ensureVisibleSandboxSessionPath(
  database: D1Database,
  input: {
    sandboxId: SandboxId;
    sessionId: SessionId;
  },
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({ sessionStatus: sessionsTable.status })
      .from(sandboxSessionsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
      .where(
        and(
          eq(sandboxSessionsTable.sandboxId, input.sandboxId),
          eq(sandboxSessionsTable.sessionId, input.sessionId),
          inArray(sandboxSessionsTable.status, ["active", "closed"]),
          isNull(sessionsTable.archivedAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null || row.sessionStatus === "TERMINATED") {
    throw validationError("Session files are not available for this agent.");
  }
}

async function ensureVisibleSpaceMountPath(
  database: D1Database,
  input: {
    path: string;
    sandboxId: SandboxId;
    viewerId: AccountId;
  },
): Promise<void> {
  const aliases = await listSandboxSpaceAliases(database, input.sandboxId, input.viewerId);

  if (!aliases.some((alias) => alias.globalMountPath === input.path)) {
    throw validationError("Space mount is not available for this agent.");
  }
}

export async function ensureAgentFilePathAdmission(
  database: D1Database,
  input: {
    path: string;
    sandboxId: SandboxId;
    viewerId: AccountId;
  },
): Promise<void> {
  const sessionId = getSessionIdFromAgentFilePath(input.path);

  if (sessionId !== null) {
    await ensureVisibleSandboxSessionPath(database, {
      sandboxId: input.sandboxId,
      sessionId,
    });
    return;
  }

  const spaceMountPath = getSpaceMountPathFromAgentFilePath(input.path);

  if (spaceMountPath !== null) {
    await ensureVisibleSpaceMountPath(database, {
      path: spaceMountPath,
      sandboxId: input.sandboxId,
      viewerId: input.viewerId,
    });
  }
}

export async function listVirtualTreeEntries(input: {
  database: D1Database;
  path: string;
  sandboxId: SandboxId;
  viewerId: AccountId;
}): Promise<ListingParseResult | null> {
  switch (input.path) {
    case "/": {
      return {
        entries: [
          toDirectoryEntry({
            name: "workspace",
            path: SANDBOX_WORKSPACE_ROOT,
            persistence: "temporary",
          }),
          toDirectoryEntry({
            name: "organization",
            path: SANDBOX_ORGANIZATION_ROOT,
            persistence: "persistent",
          }),
        ],
        totalCount: 2,
        truncated: false,
      };
    }
    case SANDBOX_WORKSPACE_ROOT: {
      return {
        entries: [
          toDirectoryEntry({
            name: "memory",
            path: SANDBOX_MEMORY_PATH,
            persistence: "persistent",
          }),
          toDirectoryEntry({
            name: "se",
            path: SANDBOX_SESSION_ROOT,
            persistence: "temporary",
          }),
        ],
        totalCount: 2,
        truncated: false,
      };
    }
    case SANDBOX_SESSION_ROOT: {
      const entries = await getSandboxSessionEntries(input.database, input.sandboxId);
      return {
        entries,
        totalCount: entries.length,
        truncated: false,
      };
    }
    case SANDBOX_ORGANIZATION_ROOT: {
      return {
        entries: [
          toDirectoryEntry({
            name: "sp",
            path: SANDBOX_GLOBAL_SPACE_ROOT,
            persistence: "persistent",
          }),
        ],
        totalCount: 1,
        truncated: false,
      };
    }
    case SANDBOX_GLOBAL_SPACE_ROOT: {
      const entries = await getSandboxSpaceEntries(input.database, input.viewerId, input.sandboxId);
      return {
        entries,
        totalCount: entries.length,
        truncated: false,
      };
    }
    default: {
      if (input.path.startsWith(`${SANDBOX_GLOBAL_SPACE_ROOT}/`)) {
        return {
          entries: [],
          totalCount: 0,
          truncated: false,
        };
      }

      return null;
    }
  }
}

export function emptyAgentFileTree(input: {
  agentId: AgentId;
  lastError: string | null;
  path: string;
  sandbox: AgentFileBrowserSandboxRecord | null;
  sandboxStatus?: AgentFileSandboxStatus;
}): AgentFileTree {
  return {
    agentId: input.agentId,
    entries: [],
    lastError: input.lastError,
    path: input.path,
    sandboxId: input.sandbox?.id ?? null,
    sandboxStatus: input.sandboxStatus ?? input.sandbox?.status ?? "missing",
    totalCount: 0,
    truncated: false,
  };
}

export function finalizeAgentFileEntries(entries: AgentFileTreeListingEntry[]): AgentFileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    session: entry.session ?? null,
    space: entry.space ?? null,
  }));
}
