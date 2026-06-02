import type { SandboxStatus } from "@mosoo/contracts/sandbox";
import { agentsTable, organizationMembersTable, sandboxesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, SandboxId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, notFoundError } from "../../../platform/errors";
import { ensureActiveAgentMembership } from "../../agents/application/agent-access.service";
import { agentRowColumns } from "../../agents/application/agent-repository";
import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import type { RuntimeSandboxSubject } from "../domain/runtime-sandbox-subject";
import { resolveStableAgentRuntimeSubject } from "../domain/runtime-sandbox-subject";
import type { AgentFileSandboxStatus } from "./agent-file-browser-model";

export interface AgentFileBrowserSandboxRecord {
  id: SandboxId;
  lastError: string | null;
  status: SandboxStatus;
}

export interface AgentFileBrowserUnavailableSandbox {
  lastError: string | null;
  status: Extract<AgentFileSandboxStatus, "missing" | "unsupported">;
}

export interface AgentFileBrowserTarget {
  agent: Pick<AgentRow, "id" | "kind" | "name" | "organizationId" | "ownerId">;
  sandbox: AgentFileBrowserSandboxRecord | null;
  unavailableSandbox: AgentFileBrowserUnavailableSandbox | null;
  subject: RuntimeSandboxSubject;
}

function toSandboxRecord(row: {
  sandboxId: string | null;
  sandboxLastError: string | null;
  sandboxStatus: SandboxStatus | null;
}): {
  sandbox: AgentFileBrowserSandboxRecord | null;
  unavailableSandbox: AgentFileBrowserUnavailableSandbox | null;
} {
  if (row.sandboxId === null || row.sandboxStatus === null) {
    return {
      sandbox: null,
      unavailableSandbox: {
        lastError: null,
        status: "missing",
      },
    };
  }

  let sandboxId: SandboxId;

  try {
    sandboxId = parsePlatformId<SandboxId>(row.sandboxId, "Agent sandbox ID");
  } catch {
    return {
      sandbox: null,
      unavailableSandbox: {
        lastError: "Sandbox ID is not canonical. Recreate the agent sandbox to use file browser.",
        status: "unsupported",
      },
    };
  }

  return {
    sandbox: {
      id: sandboxId,
      lastError: row.sandboxLastError,
      status: row.sandboxStatus,
    },
    unavailableSandbox: null,
  };
}

export async function resolveAgentFileBrowserTarget(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: string,
): Promise<AgentFileBrowserTarget> {
  const normalizedAgentId = parsePlatformId<AgentId>(agentId, "agent id");
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer id");
  const row =
    (await getAppDatabase(database)
      .select({
        ...agentRowColumns,
        sandboxId: sandboxesTable.id,
        sandboxLastError: sandboxesTable.lastError,
        sandboxStatus: sandboxesTable.status,
        viewerMembershipDisabledAt: organizationMembersTable.disabledAt,
        viewerMembershipRole: organizationMembersTable.role,
      })
      .from(agentsTable)
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, agentsTable.organizationId),
          eq(organizationMembersTable.accountId, viewerId),
        ),
      )
      .leftJoin(
        sandboxesTable,
        and(
          eq(sandboxesTable.kind, agentsTable.kind),
          eq(sandboxesTable.subjectKind, "agent"),
          eq(sandboxesTable.subjectId, agentsTable.id),
        ),
      )
      .where(eq(agentsTable.id, normalizedAgentId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw notFoundError("Agent not found.");
  }

  const {
    sandboxId,
    sandboxLastError,
    sandboxStatus,
    viewerMembershipDisabledAt,
    viewerMembershipRole,
    ...agent
  } = row;

  ensureActiveAgentMembership({
    viewerMembershipDisabledAt,
    viewerMembershipRole,
  });

  if (agent.ownerId !== viewerId) {
    throw forbiddenError();
  }

  const policy = getRuntimeKindPolicy(agent.kind);

  if (policy.subject.scope !== "agent") {
    throw notFoundError("Agent sandbox is not available.");
  }

  const sandboxAdmission = toSandboxRecord({
    sandboxId,
    sandboxLastError,
    sandboxStatus,
  });

  return {
    agent,
    sandbox: sandboxAdmission.sandbox,
    subject: resolveStableAgentRuntimeSubject({
      agentId: agent.id,
      kind: agent.kind,
    }),
    unavailableSandbox: sandboxAdmission.unavailableSandbox,
  };
}
