export type MosooCustomEventDirection = "server";

interface MosooCustomEventRegistration<
  TName extends string,
  TDirection extends MosooCustomEventDirection,
> {
  readonly coalescing?: "replace";
  readonly direction: TDirection;
  readonly name: TName;
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
  sessionRunUpdated: {
    direction: "server",
    name: "mosoo.session.run.updated",
  },
  sessionStopped: {
    direction: "server",
    name: "mosoo.session.stopped",
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
export type ReplaceableCustomEventName = Extract<
  MosooCustomEventRegistrationValue,
  { coalescing: "replace" }
>["name"];

export const REPLACEABLE_CUSTOM_EVENT_NAMES = Object.values(MOSOO_CUSTOM_EVENT)
  .filter((event) => "coalescing" in event && event.coalescing === "replace")
  .map((event): MosooCustomEventName => event.name);
