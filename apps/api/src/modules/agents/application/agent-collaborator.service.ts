import type {
  AddAgentCollaboratorInput,
  AgentCollaborator,
  RemoveAgentCollaboratorInput,
  UpdateAgentCollaboratorInput,
} from "@mosoo/contracts/agent";
import { accountsTable, agentsTable } from "@mosoo/db";
import type { AccountId, AgentId } from "@mosoo/id";
import { eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { appendSuccessfulControlOperationAuditEvent } from "../../control-operations/application/control-operation-outcome-audit.service";
import {
  deleteResourceAcl,
  insertResourceAclIfAbsent,
  principalToAclTarget,
  updateResourceAclRole,
} from "../../resource-access/application/resource-acl.service";
import {
  ensureAgentAccess,
  ensureAgentDestructiveAccess,
  resolveAgentStatusAfterEditorMutation,
} from "./agent-access.service";
import { readAccountId } from "./agent-platform-ids";
import { hasPersonalMcpBindings, listAgentCollaboratorRows } from "./agent-repository";
import type { AgentRow, CollaboratorRow } from "./agent-types";

function readAgentCollaboratorPrincipal(principal: string): AccountId | "*" {
  return principal === "*" ? principal : readAccountId(principal, "Agent collaborator principal");
}

async function appendAgentAclAuditEvent(
  database: D1Database,
  input: {
    agent: AgentRow;
    operationName: "addAgentCollaborator" | "removeAgentCollaborator" | "updateAgentCollaborator";
    principal: string;
    role?: string;
    viewer: AuthenticatedViewer;
    viewerRole: string;
  },
): Promise<void> {
  await appendSuccessfulControlOperationAuditEvent(database, {
    metadata: {
      kind: "acl",
      owner_at_time_id: input.agent.ownerId,
      principal: input.principal,
      ...(input.role ? { role: input.role } : {}),
      viewerRole: input.viewerRole,
    },
    organizationId: input.agent.organizationId,
    operationName: input.operationName,
    resourceDisplay: input.agent.name,
    resourceId: input.agent.id,
    viewer: input.viewer,
  });
}

async function enrichCollaborators(
  database: D1Database,
  rows: CollaboratorRow[],
): Promise<AgentCollaborator[]> {
  const accountIds = [
    ...new Set(rows.map((row) => row.principal).filter((principal) => principal !== "*")),
  ].map((principal) => readAccountId(principal, "Agent collaborator principal"));
  const accounts =
    accountIds.length === 0
      ? []
      : await getAppDatabase(database)
          .select({
            email: accountsTable.email,
            id: accountsTable.id,
            imageUrl: accountsTable.image,
            name: accountsTable.name,
          })
          .from(accountsTable)
          .where(inArray(accountsTable.id, accountIds))
          .all();
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return rows.map((row) => {
    if (row.principal === "*") {
      return {
        email: null,
        imageUrl: null,
        name: "Everyone in organization",
        principal: row.principal,
        role: row.role,
      };
    }

    const user = accountsById.get(readAccountId(row.principal, "Agent collaborator principal"));

    return {
      email: user?.email ?? null,
      imageUrl: user?.imageUrl ?? null,
      name: user?.name ?? null,
      principal: row.principal,
      role: row.role,
    };
  });
}

export async function listAgentCollaborators(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentCollaborator[]> {
  await ensureAgentAccess(database, viewer.id, agentId);
  return enrichCollaborators(database, await listAgentCollaboratorRows(database, agentId));
}

export async function addAgentCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AddAgentCollaboratorInput,
): Promise<void> {
  const editable = await ensureAgentDestructiveAccess(database, viewer.id, input.agentId);
  const timestampMs = currentTimestampMs();

  if (input.principal === "*" && input.role !== "user") {
    throw new Error("Everyone in organization can only be granted user access.");
  }

  if (await hasPersonalMcpBindings(database, input.agentId)) {
    throw new Error("An agent with personal MCP bindings can only be shared privately.");
  }

  await insertResourceAclIfAbsent(database, {
    assignedByAccountId: viewer.id,
    createdAt: timestampMs,
    resourceId: input.agentId,
    resourceType: "agent",
    role: input.role,
    target: principalToAclTarget(
      editable.agent.organizationId,
      readAgentCollaboratorPrincipal(input.principal),
    ),
  });
  await getAppDatabase(database)
    .update(agentsTable)
    .set({
      status: resolveAgentStatusAfterEditorMutation(editable.agent, editable.viewerRole),
      updatedAt: timestampMs,
    })
    .where(eq(agentsTable.id, input.agentId))
    .run();

  await appendAgentAclAuditEvent(database, {
    agent: editable.agent,
    operationName: "addAgentCollaborator",
    principal: input.principal,
    role: input.role,
    viewer,
    viewerRole: editable.viewerRole,
  });
}

export async function removeAgentCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RemoveAgentCollaboratorInput,
): Promise<void> {
  const editable = await ensureAgentDestructiveAccess(database, viewer.id, input.agentId);
  const timestampMs = currentTimestampMs();
  const target = principalToAclTarget(
    editable.agent.organizationId,
    readAgentCollaboratorPrincipal(input.principal),
  );

  await deleteResourceAcl(database, {
    resourceId: input.agentId,
    resourceType: "agent",
    target,
  });
  await getAppDatabase(database)
    .update(agentsTable)
    .set({
      status: resolveAgentStatusAfterEditorMutation(editable.agent, editable.viewerRole),
      updatedAt: timestampMs,
    })
    .where(eq(agentsTable.id, input.agentId))
    .run();

  await appendAgentAclAuditEvent(database, {
    agent: editable.agent,
    operationName: "removeAgentCollaborator",
    principal: input.principal,
    viewer,
    viewerRole: editable.viewerRole,
  });
}

export async function updateAgentCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateAgentCollaboratorInput,
): Promise<void> {
  const editable = await ensureAgentDestructiveAccess(database, viewer.id, input.agentId);
  const timestampMs = currentTimestampMs();

  if (input.principal === "*" && input.role !== "user") {
    throw new Error("Everyone in organization can only be granted user access.");
  }

  if (await hasPersonalMcpBindings(database, input.agentId)) {
    throw new Error("An agent with personal MCP bindings can only be shared privately.");
  }

  await updateResourceAclRole(database, {
    assignedByAccountId: viewer.id,
    createdAt: timestampMs,
    resourceId: input.agentId,
    resourceType: "agent",
    role: input.role,
    target: principalToAclTarget(
      editable.agent.organizationId,
      readAgentCollaboratorPrincipal(input.principal),
    ),
  });

  await getAppDatabase(database)
    .update(agentsTable)
    .set({
      status: resolveAgentStatusAfterEditorMutation(editable.agent, editable.viewerRole),
      updatedAt: timestampMs,
    })
    .where(eq(agentsTable.id, input.agentId))
    .run();

  await appendAgentAclAuditEvent(database, {
    agent: editable.agent,
    operationName: "updateAgentCollaborator",
    principal: input.principal,
    role: input.role,
    viewer,
    viewerRole: editable.viewerRole,
  });
}
