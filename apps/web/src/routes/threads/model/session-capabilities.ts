import type {
  AgentSessionActionCapability,
  AgentSessionActionCapabilityName,
  AgentSessionActionCapabilityStatus,
} from "@mosoo/contracts/session";

import type { ThreadBucket } from "./thread";

type Translate = (key: string, variables?: Record<string, string>) => string;

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

const DEFAULT_TRANSLATIONS: Record<string, string> = {
  "threads.sessionCapabilitiesLoading": "Loading session capabilities.",
  "threads.sessionCapabilityUnavailable": "Session capability is unavailable.",
};

const defaultTranslate: Translate = (key) => DEFAULT_TRANSLATIONS[key] ?? key;

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
  t: Translate;
}): ThreadActionCapabilityView {
  if (input.capabilities === null) {
    return unavailableCapability({
      action: input.action,
      reason: input.t("threads.sessionCapabilitiesLoading"),
    });
  }

  const capability = findCapability({
    action: input.action,
    capabilities: input.capabilities,
  });

  if (capability === null) {
    return unavailableCapability({
      action: input.action,
      reason: input.t("threads.sessionCapabilityUnavailable"),
    });
  }

  return {
    action: capability.action,
    available: capability.status !== "unavailable",
    reason:
      capability.status === "unavailable" && capability.reason === null
        ? input.t("threads.sessionCapabilityUnavailable")
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
  t?: Translate;
}): ThreadActionCapabilities {
  const t = input.t ?? defaultTranslate;

  return {
    archive: getThreadActionCapability({
      action: "archive_session",
      capabilities: input.capabilities,
      t,
    }),
    delete: getThreadActionCapability({
      action: "delete_session",
      capabilities: input.capabilities,
      t,
    }),
    followUp: getThreadActionCapability({
      action: getFollowUpCapabilityAction(input.bucket),
      capabilities: input.capabilities,
      t,
    }),
  };
}
