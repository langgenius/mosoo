import type {
  AgentSessionActionCapability,
  AgentSessionActionCapabilityName,
  SessionStatus,
  SessionSummary,
} from "@mosoo/contracts/session";
import {
  AGENT_SESSION_ACTION_CAPABILITY_NAMES,
  AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
  getAgentSessionUserLifecycleProjection,
} from "@mosoo/contracts/session";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

interface ActionCapabilityContext {
  archivedAt?: number | string | null;
  runtimeId: string;
  status?: SessionStatus;
}

const RUNTIME_ACTIONS = new Set<AgentSessionActionCapabilityName>([
  "connect_stream",
  "create_session",
  "permission_decision",
  "send_user_message",
  "user_interrupt",
]);

function getActiveMutationUnavailableReason(
  session: Pick<ActionCapabilityContext, "archivedAt" | "status">,
): string | null {
  const lifecycle = getAgentSessionUserLifecycleProjection(session);

  if (lifecycle.readOnly) {
    return lifecycle.recoverability.reason;
  }

  return null;
}

function getSessionActionUnavailableReason(input: {
  action: AgentSessionActionCapabilityName;
  session: Pick<ActionCapabilityContext, "archivedAt" | "status">;
}): string | null {
  const { action, session } = input;

  switch (action) {
    case "add_session_resource":
    case "permission_decision":
    case "send_user_message":
    case "user_interrupt": {
      return getActiveMutationUnavailableReason(session);
    }
    case "archive_session": {
      const lifecycle = getAgentSessionUserLifecycleProjection(session);

      if (lifecycle.terminal) {
        return AGENT_SESSION_TERMINAL_READ_ONLY_REASON;
      }

      return lifecycle.state === "asleep" ? "Session is already archived." : null;
    }
    case "unarchive_session": {
      const lifecycle = getAgentSessionUserLifecycleProjection(session);

      if (lifecycle.terminal) {
        return AGENT_SESSION_TERMINAL_READ_ONLY_REASON;
      }

      return lifecycle.state === "asleep" ? null : "Session is not archived.";
    }
    case "connect_stream":
    case "create_session":
    case "delete_session":
    case "retrieve_session": {
      return null;
    }
  }
}

function resolveActionCapability(
  action: AgentSessionActionCapabilityName,
  session: Pick<SessionSummary, "archivedAt" | "runtimeId" | "status"> | ActionCapabilityContext,
): AgentSessionActionCapability {
  const reason =
    getSessionActionUnavailableReason({ action, session }) ??
    (RUNTIME_ACTIONS.has(action) && getRuntimeCatalogEntry(session.runtimeId) === null
      ? "Runtime is not supported."
      : null);

  return { action, reason, status: reason === null ? "available" : "unavailable" };
}

export function getAgentSessionActionCapabilities(
  session: Pick<SessionSummary, "archivedAt" | "runtimeId" | "status"> | ActionCapabilityContext,
): AgentSessionActionCapability[] {
  return AGENT_SESSION_ACTION_CAPABILITY_NAMES.map((action) =>
    resolveActionCapability(action, session),
  );
}

export function getAgentSessionActionCapability(input: {
  action: AgentSessionActionCapabilityName;
  archivedAt?: number | string | null;
  runtimeId: string;
  status?: SessionStatus;
}): AgentSessionActionCapability {
  return resolveActionCapability(input.action, input);
}

export class AgentSessionActionUnavailableError extends Error {
  override name = "AgentSessionActionUnavailableError";
}

export function getAvailableAgentSessionActionCapability(input: {
  action: AgentSessionActionCapabilityName;
  archivedAt?: number | string | null;
  runtimeId: string;
  status?: SessionStatus;
}): AgentSessionActionCapability {
  const capability = getAgentSessionActionCapability(input);

  if (capability.status === "unavailable") {
    throw new AgentSessionActionUnavailableError(
      capability.reason ?? `Agent Session action ${input.action} is unavailable.`,
    );
  }

  return capability;
}
