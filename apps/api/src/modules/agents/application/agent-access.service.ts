import type {
  Agent,
  AgentOwnerSummary,
  AgentViewerRole,
  RuntimeStateOperationName,
} from "@mosoo/contracts/agent";
import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import type { AccountId, AgentId } from "@mosoo/id";

import { forbiddenError } from "../../../platform/errors";
import { getAgentAccessRecord } from "./agent-repository";
import { parseAgentStoredConfig } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";

type AgentPrivilegedRole = Extract<AgentViewerRole, "owner" | "admin">;
type AgentReadableRole = Extract<AgentViewerRole, "owner" | "admin" | "user">;

interface AgentAccessContext {
  agent: AgentRow;
  owner: AgentOwnerSummary;
  viewerAclRole: Extract<AgentViewerRole, "admin" | "user"> | null;
  viewerRole: AgentViewerRole;
}

interface AgentPrivilegedAccess {
  agent: AgentRow;
  viewerRole: AgentPrivilegedRole;
}

interface AgentReadableAccess {
  agent: AgentRow;
  viewerRole: AgentReadableRole;
}

export function resolveAgentViewerRole(
  agent: AgentRow,
  viewerId: AccountId,
  viewerAclRoleRank: number,
  organizationRole?: OrganizationMemberRole | null,
): AgentViewerRole {
  if (agent.ownerId === viewerId) {
    return "owner";
  }

  if (can(organizationRole, Permission.AgentsListAll)) {
    return "admin";
  }

  if (viewerAclRoleRank >= 2) {
    return "admin";
  }

  if (viewerAclRoleRank >= 1) {
    return "user";
  }

  return "none";
}

function viewerAclRoleFromRank(
  viewerAclRoleRank: number,
): Extract<AgentViewerRole, "admin" | "user"> | null {
  if (viewerAclRoleRank >= 2) {
    return "admin";
  }

  if (viewerAclRoleRank >= 1) {
    return "user";
  }

  return null;
}

export function canReadAgent(agent: AgentRow, viewerRole: AgentViewerRole): boolean {
  if (viewerRole === "owner" || viewerRole === "admin") {
    return true;
  }

  return agent.status === "published" && viewerRole === "user";
}

export function ensureActiveAgentMembership(input: {
  viewerMembershipDisabledAt: number | null;
  viewerMembershipRole: OrganizationMemberRole | null;
}): OrganizationMemberRole {
  if (input.viewerMembershipRole === null) {
    throw new Error("Organization not found.");
  }

  if (input.viewerMembershipDisabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  return input.viewerMembershipRole;
}

async function getAccessibleAgentRecord(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentAccessContext> {
  const access = await getAgentAccessRecord(database, viewerId, agentId);
  const organizationRole = ensureActiveAgentMembership(access);
  const hasOrganizationBypass = can(organizationRole, Permission.AgentsListAll);
  const viewerRole = resolveAgentViewerRole(
    access.agent,
    viewerId,
    access.viewerAclRoleRank,
    organizationRole,
  );

  if (
    viewerRole === "none" ||
    !canReadAgent(access.agent, viewerRole) ||
    (!hasOrganizationBypass && viewerRole !== "owner" && access.hasPersonalMcpBindings)
  ) {
    throw forbiddenError();
  }

  return {
    agent: access.agent,
    owner: access.owner,
    viewerAclRole: viewerAclRoleFromRank(access.viewerAclRoleRank),
    viewerRole,
  };
}

export async function ensureAgentReadable(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentAccessContext> {
  return getAccessibleAgentRecord(database, viewerId, agentId);
}

export async function ensureAgentAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentRow> {
  const accessible = await getAccessibleAgentRecord(database, viewerId, agentId);
  return accessible.agent;
}

export async function ensureAgentEditor(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentPrivilegedAccess> {
  const accessible = await getAccessibleAgentRecord(database, viewerId, agentId);

  if (accessible.viewerRole !== "owner" && accessible.viewerRole !== "admin") {
    throw forbiddenError();
  }

  return {
    agent: accessible.agent,
    viewerRole: accessible.viewerRole,
  };
}

export async function ensureAgentPackageAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentReadableAccess> {
  const accessible = await getAccessibleAgentRecord(database, viewerId, agentId);

  if (accessible.viewerRole === "owner" || accessible.viewerRole === "admin") {
    return {
      agent: accessible.agent,
      viewerRole: accessible.viewerRole,
    };
  }

  if (
    accessible.viewerRole === "user" &&
    accessible.agent.status === "published" &&
    parseAgentStoredConfig(accessible.agent.configJson).packageSharingEnabled
  ) {
    return {
      agent: accessible.agent,
      viewerRole: accessible.viewerRole,
    };
  }

  throw forbiddenError();
}

export async function ensureAgentCostAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentReadableAccess> {
  const accessible = await getAccessibleAgentRecord(database, viewerId, agentId);

  if (accessible.viewerRole === "owner" || accessible.viewerRole === "admin") {
    return {
      agent: accessible.agent,
      viewerRole: accessible.viewerRole,
    };
  }

  if (accessible.viewerRole === "user") {
    if (accessible.viewerAclRole !== null) {
      return {
        agent: accessible.agent,
        viewerRole: accessible.viewerRole,
      };
    }
  }

  throw forbiddenError();
}

export async function ensureAgentRuntimeLogAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentPrivilegedAccess> {
  return ensureAgentEditor(database, viewerId, agentId);
}

export async function ensureAgentRuntimeOperationAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
  operation: RuntimeStateOperationName,
): Promise<AgentPrivilegedAccess> {
  if (operation === "resetAgentState") {
    return ensureAgentDestructiveAccess(database, viewerId, agentId);
  }

  return ensureAgentEditor(database, viewerId, agentId);
}

export async function ensureAgentOwner(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentRow> {
  const access = await getAgentAccessRecord(database, viewerId, agentId);
  ensureActiveAgentMembership(access);

  if (access.agent.ownerId !== viewerId) {
    throw forbiddenError();
  }

  return access.agent;
}

export async function ensureAgentDestructiveAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentPrivilegedAccess> {
  const access = await getAgentAccessRecord(database, viewerId, agentId);
  const organizationRole = ensureActiveAgentMembership(access);

  if (access.agent.ownerId === viewerId) {
    return {
      agent: access.agent,
      viewerRole: "owner",
    };
  }

  if (organizationRole === "owner") {
    return {
      agent: access.agent,
      viewerRole: "admin",
    };
  }

  if (organizationRole === "admin" && !access.ownerMembershipActive) {
    return {
      agent: access.agent,
      viewerRole: "admin",
    };
  }

  throw forbiddenError();
}

export function resolveAgentStatusAfterEditorMutation(
  agent: AgentRow,
  _viewerRole: AgentPrivilegedRole,
): Agent["status"] {
  return agent.status;
}
