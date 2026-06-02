import type {
  AgentSessionActionCapability,
  AgentSessionActionCapabilityName,
  AgentSessionActionCapabilityStatus,
  SessionStatus,
  SessionSummary,
} from "@mosoo/contracts/session";
import {
  AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
  getAgentSessionUserLifecycleProjection,
} from "@mosoo/contracts/session";
import type { RuntimeCatalogCapabilityId } from "@mosoo/runtime-catalog";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

interface CapabilitySpec {
  action: AgentSessionActionCapabilityName;
  requiredCapabilities: RuntimeCatalogCapabilityId[];
}

interface ActionCapabilityContext {
  archivedAt?: number | string | null;
  isSessionCreator?: boolean;
  runtimeId: string;
  status?: SessionStatus;
}

const ACTION_CAPABILITY_SPECS: CapabilitySpec[] = [
  {
    action: "add_session_resource",
    requiredCapabilities: [],
  },
  {
    action: "archive_session",
    requiredCapabilities: [],
  },
  {
    action: "create_session",
    requiredCapabilities: ["input_start"],
  },
  {
    action: "delete_session",
    requiredCapabilities: [],
  },
  {
    action: "list_session_resources",
    requiredCapabilities: [],
  },
  {
    action: "permission_decision",
    requiredCapabilities: ["permission_request"],
  },
  {
    action: "remove_session_resource",
    requiredCapabilities: [],
  },
  {
    action: "retrieve_session",
    requiredCapabilities: [],
  },
  {
    action: "connect_stream",
    requiredCapabilities: ["text_stream"],
  },
  {
    action: "send_user_message",
    requiredCapabilities: ["input_start"],
  },
  {
    action: "unarchive_session",
    requiredCapabilities: [],
  },
];

function formatMissingCapabilities(capabilities: RuntimeCatalogCapabilityId[]): string {
  return capabilities.map((capability) => capability.replaceAll("_", " ")).join(", ");
}

function createCapability(input: {
  action: AgentSessionActionCapabilityName;
  reason: string | null;
  status: AgentSessionActionCapabilityStatus;
}): AgentSessionActionCapability {
  return {
    action: input.action,
    reason: input.reason,
    status: input.status,
  };
}

function getActiveMutationUnavailableReason(
  session: Pick<ActionCapabilityContext, "archivedAt" | "status">,
): string | null {
  const lifecycle = getAgentSessionUserLifecycleProjection(session);

  if (lifecycle.readOnly) {
    return lifecycle.recoverability.reason;
  }

  return null;
}

function requiresSessionMutationAuthority(action: AgentSessionActionCapabilityName): boolean {
  switch (action) {
    case "add_session_resource":
    case "archive_session":
    case "delete_session":
    case "permission_decision":
    case "remove_session_resource":
    case "send_user_message":
    case "unarchive_session":
    case "user_interrupt": {
      return true;
    }
    case "connect_stream":
    case "create_session":
    case "list_session_resources":
    case "retrieve_session": {
      return false;
    }
    default: {
      throw new Error("Unknown Agent Session action capability.");
    }
  }
}

function getSessionActionUnavailableReason(input: {
  action: AgentSessionActionCapabilityName;
  session: Pick<ActionCapabilityContext, "archivedAt" | "isSessionCreator" | "status">;
}): string | null {
  const { action, session } = input;

  if (requiresSessionMutationAuthority(action) && session.isSessionCreator === false) {
    return "Only the session creator can mutate this session.";
  }

  switch (action) {
    case "add_session_resource":
    case "permission_decision":
    case "remove_session_resource":
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
    case "delete_session": {
      return null;
    }
    case "connect_stream":
    case "create_session":
    case "list_session_resources":
    case "retrieve_session": {
      return null;
    }
    default: {
      throw new Error("Unknown Agent Session action capability.");
    }
  }
}

function resolveActionCapability(input: {
  capabilities: Set<RuntimeCatalogCapabilityId>;
  spec: CapabilitySpec;
}): AgentSessionActionCapability {
  const missing = input.spec.requiredCapabilities.filter(
    (capability) => !input.capabilities.has(capability),
  );

  if (missing.length === 0) {
    return createCapability({
      action: input.spec.action,
      reason: null,
      status: "available",
    });
  }

  return createCapability({
    action: input.spec.action,
    reason: `Runtime does not declare ${formatMissingCapabilities(missing)}.`,
    status: "unavailable",
  });
}

function resolveInterruptCapability(
  capabilities: Set<RuntimeCatalogCapabilityId>,
): AgentSessionActionCapability {
  if (capabilities.has("turn_cancel")) {
    return createCapability({
      action: "user_interrupt",
      reason: null,
      status: "available",
    });
  }

  return createCapability({
    action: "user_interrupt",
    reason: "Runtime does not declare turn cancel support.",
    status: "unavailable",
  });
}

export function getAgentSessionActionCapabilities(
  session: Pick<SessionSummary, "archivedAt" | "runtimeId" | "status"> | ActionCapabilityContext,
): AgentSessionActionCapability[] {
  const runtime = getRuntimeCatalogEntry(session.runtimeId);
  const capabilities = new Set(
    runtime?.capabilities
      .filter((capability) => capability.status === "supported")
      .map((capability) => capability.id),
  );
  const gateSessionState = (
    capability: AgentSessionActionCapability,
  ): AgentSessionActionCapability => {
    const unavailableReason = getSessionActionUnavailableReason({
      action: capability.action,
      session,
    });

    if (unavailableReason === null) {
      return capability;
    }

    return createCapability({
      action: capability.action,
      reason: unavailableReason,
      status: "unavailable",
    });
  };

  return [
    ...ACTION_CAPABILITY_SPECS.map((spec) => resolveActionCapability({ capabilities, spec })),
    resolveInterruptCapability(capabilities),
  ].map(gateSessionState);
}

export function getAgentSessionActionCapability(input: {
  action: AgentSessionActionCapabilityName;
  archivedAt?: number | string | null;
  isSessionCreator?: boolean;
  runtimeId: string;
  status?: SessionStatus;
}): AgentSessionActionCapability {
  const capability = getAgentSessionActionCapabilities(input).find(
    (candidate) => candidate.action === input.action,
  );

  if (!capability) {
    throw new Error(`Unknown Agent Session action capability: ${input.action}.`);
  }

  return capability;
}

export function getAvailableAgentSessionActionCapability(input: {
  action: AgentSessionActionCapabilityName;
  archivedAt?: number | string | null;
  isSessionCreator?: boolean;
  runtimeId: string;
  status?: SessionStatus;
}): AgentSessionActionCapability {
  const capability = getAgentSessionActionCapability(input);

  if (capability.status === "unavailable") {
    throw new Error(capability.reason ?? `Agent Session action ${input.action} is unavailable.`);
  }

  return capability;
}
