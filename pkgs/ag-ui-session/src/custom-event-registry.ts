export type MosooCustomEventDirection = "server" | "viewer";

interface MosooCustomEventRegistration<
  TName extends string,
  TDirection extends MosooCustomEventDirection,
> {
  readonly coalescing?: "replace";
  readonly direction: TDirection;
  readonly name: TName;
  readonly visibility?: "all_consumers" | "owner_debug";
}

export const MOSOO_CUSTOM_EVENT = {
  agentReady: {
    direction: "server",
    name: "mosoo.agent.ready",
  },
  agentUpdating: {
    direction: "server",
    name: "mosoo.agent.updating",
  },
  sessionCommandsUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.commands.updated",
  },
  sessionConfigTrace: {
    direction: "server",
    name: "mosoo.session.config.trace",
    visibility: "owner_debug",
  },
  sessionRuntimeTiming: {
    direction: "server",
    name: "mosoo.session.runtime.timing",
    visibility: "owner_debug",
  },
  sessionRuntimeTimelineUpdated: {
    direction: "server",
    name: "mosoo.session.runtime.timeline.updated",
  },
  sessionConfigUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.config.updated",
  },
  sessionFilesUpdated: {
    direction: "server",
    name: "mosoo.session.files.updated",
  },
  sessionInfoUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.info.updated",
  },
  sessionInfraRescheduling: {
    direction: "server",
    name: "mosoo.session.infra.rescheduling",
  },
  sessionInfraRunning: {
    direction: "server",
    name: "mosoo.session.infra.running",
  },
  sessionModeUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.mode.updated",
  },
  sessionPermissionsUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.permissions.updated",
  },
  sessionPlanUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.plan.updated",
  },
  sessionReadiness: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.readiness",
  },
  sessionRunUpdated: {
    direction: "server",
    name: "mosoo.session.run.updated",
  },
  sessionStopped: {
    direction: "server",
    name: "mosoo.session.stopped",
  },
  sessionSyncRequest: {
    direction: "viewer",
    name: "mosoo.session.sync.request",
  },
  sessionUsageUpdated: {
    coalescing: "replace",
    direction: "server",
    name: "mosoo.session.usage.updated",
  },
} as const satisfies Record<
  string,
  MosooCustomEventRegistration<string, MosooCustomEventDirection>
>;

type MosooCustomEventRegistry = typeof MOSOO_CUSTOM_EVENT;
type MosooCustomEventRegistrationValue = MosooCustomEventRegistry[keyof MosooCustomEventRegistry];

export type MosooCustomEventName = MosooCustomEventRegistrationValue["name"];
export type MosooServerEventName = Extract<
  MosooCustomEventRegistrationValue,
  { direction: "server" }
>["name"];
export type MosooViewerEventName = Extract<
  MosooCustomEventRegistrationValue,
  { direction: "viewer" }
>["name"];
export type ReplaceableCustomEventName = Extract<
  MosooCustomEventRegistrationValue,
  { coalescing: "replace" }
>["name"];
export type OwnerDebugCustomEventName = Extract<
  MosooCustomEventRegistrationValue,
  { visibility: "owner_debug" }
>["name"];

const customEventRegistrations = Object.values(MOSOO_CUSTOM_EVENT);
const customEventName = (event: MosooCustomEventRegistrationValue): MosooCustomEventName =>
  event.name;

export const REPLACEABLE_CUSTOM_EVENT_NAMES = customEventRegistrations
  .filter((event) => "coalescing" in event && event.coalescing === "replace")
  .map(customEventName);
export const OWNER_DEBUG_CUSTOM_EVENT_NAMES = customEventRegistrations
  .filter((event) => "visibility" in event && event.visibility === "owner_debug")
  .map(customEventName);

const customEventVisibilityByName = new Map<string, "all_consumers" | "owner_debug">(
  customEventRegistrations.flatMap((event) =>
    "visibility" in event && event.visibility !== undefined
      ? [[event.name, event.visibility] as const]
      : [],
  ),
);

export function getMosooCustomEventVisibility(
  name: string,
): "all_consumers" | "owner_debug" | null {
  return customEventVisibilityByName.get(name) ?? null;
}
