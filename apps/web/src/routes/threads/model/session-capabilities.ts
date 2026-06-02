import type {
  AgentSessionActionCapability,
  AgentSessionActionCapabilityName,
  AgentSessionActionCapabilityStatus,
} from "@mosoo/contracts/session";

import type { ThreadBucket } from "./thread";

export type ThreadActionCapabilityInput = Pick<
  AgentSessionActionCapability,
  "action" | "reason" | "status"
>;

export interface ThreadActionCapabilityView {
  action: AgentSessionActionCapabilityName;
  available: boolean;
  reason: string | null;
  status: AgentSessionActionCapabilityStatus;
}

export interface ThreadActionCapabilities {
  archive: ThreadActionCapabilityView;
  delete: ThreadActionCapabilityView;
  followUp: ThreadActionCapabilityView;
}

const CAPABILITIES_LOADING_REASON = "Loading session capabilities.";
const CAPABILITY_MISSING_REASON = "Session capability is unavailable.";

function unavailableCapability(input: {
  action: AgentSessionActionCapabilityName;
  reason: string;
}): ThreadActionCapabilityView {
  return {
    action: input.action,
    available: false,
    reason: input.reason,
    status: "unavailable",
  };
}

function findCapability(input: {
  action: AgentSessionActionCapabilityName;
  capabilities: readonly ThreadActionCapabilityInput[];
}): ThreadActionCapabilityInput | null {
  return input.capabilities.find((capability) => capability.action === input.action) ?? null;
}

function getThreadActionCapability(input: {
  action: AgentSessionActionCapabilityName;
  capabilities: readonly ThreadActionCapabilityInput[] | null;
}): ThreadActionCapabilityView {
  if (input.capabilities === null) {
    return unavailableCapability({
      action: input.action,
      reason: CAPABILITIES_LOADING_REASON,
    });
  }

  const capability = findCapability({
    action: input.action,
    capabilities: input.capabilities,
  });

  if (capability === null) {
    return unavailableCapability({
      action: input.action,
      reason: CAPABILITY_MISSING_REASON,
    });
  }

  return {
    action: capability.action,
    available: capability.status !== "unavailable",
    reason:
      capability.status === "unavailable" && capability.reason === null
        ? CAPABILITY_MISSING_REASON
        : capability.reason,
    status: capability.status,
  };
}

function getFollowUpCapabilityAction(bucket: ThreadBucket): AgentSessionActionCapabilityName {
  return bucket === "archived" ? "unarchive_session" : "send_user_message";
}

export function getThreadActionCapabilities(input: {
  bucket: ThreadBucket;
  capabilities: readonly ThreadActionCapabilityInput[] | null;
}): ThreadActionCapabilities {
  return {
    archive: getThreadActionCapability({
      action: "archive_session",
      capabilities: input.capabilities,
    }),
    delete: getThreadActionCapability({
      action: "delete_session",
      capabilities: input.capabilities,
    }),
    followUp: getThreadActionCapability({
      action: getFollowUpCapabilityAction(input.bucket),
      capabilities: input.capabilities,
    }),
  };
}
