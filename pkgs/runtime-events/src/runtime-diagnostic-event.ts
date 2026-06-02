import type { RuntimeEventKind } from "./runtime-event";
import { ingestRuntimeEventInput } from "./runtime-event-input";
import type { RuntimeEventBuildContext, RuntimeEventIngressOutcome } from "./runtime-event-input";

export interface RuntimeDiagnosticEventDefinition<TName extends string = string> {
  readonly kind: RuntimeEventKind;
  readonly name: TName;
  readonly phase: string;
  readonly status: string;
}

function runtimeDiagnosticEvent<const TName extends string>(
  name: TName,
  kind: RuntimeEventKind,
  phase: string,
  status: string,
): RuntimeDiagnosticEventDefinition<TName> {
  return {
    kind,
    name,
    phase,
    status,
  };
}

export const RUNTIME_DIAGNOSTIC_EVENT = {
  configCredentialMissing: runtimeDiagnosticEvent(
    "runtime.config.credential.missing",
    "runtime.config.updated",
    "credential",
    "failed",
  ),
  configCredentialResolved: runtimeDiagnosticEvent(
    "runtime.config.credential.resolved",
    "runtime.config.updated",
    "credential",
    "completed",
  ),
  configDeploymentVersionApplied: runtimeDiagnosticEvent(
    "runtime.config.deployment.version.applied",
    "runtime.config.updated",
    "deployment.version",
    "completed",
  ),
  configManifestRenderFailed: runtimeDiagnosticEvent(
    "runtime.config.manifest.render.failed",
    "runtime.config.updated",
    "manifest",
    "failed",
  ),
  configManifestRendered: runtimeDiagnosticEvent(
    "runtime.config.manifest.rendered",
    "runtime.config.updated",
    "manifest",
    "completed",
  ),
  configMountFailed: runtimeDiagnosticEvent(
    "runtime.config.mount.failed",
    "runtime.config.updated",
    "mount",
    "failed",
  ),
  configMountSucceeded: runtimeDiagnosticEvent(
    "runtime.config.mount.succeeded",
    "runtime.config.updated",
    "mount",
    "completed",
  ),
  driverCrashed: runtimeDiagnosticEvent(
    "runtime.driver.crashed",
    "runtime.driver.updated",
    "process",
    "failed",
  ),
  driverExitedBeforeReady: runtimeDiagnosticEvent(
    "runtime.driver.exited.before.ready",
    "runtime.driver.updated",
    "startup",
    "failed",
  ),
  driverLaunchFailed: runtimeDiagnosticEvent(
    "runtime.driver.launch.failed",
    "runtime.driver.updated",
    "launch",
    "failed",
  ),
  driverLaunchStarted: runtimeDiagnosticEvent(
    "runtime.driver.launch.started",
    "runtime.driver.updated",
    "launch",
    "started",
  ),
  driverPortNotResponding: runtimeDiagnosticEvent(
    "runtime.driver.port.not.responding",
    "runtime.driver.updated",
    "port",
    "unavailable",
  ),
  driverReady: runtimeDiagnosticEvent(
    "runtime.driver.ready",
    "runtime.driver.updated",
    "ready",
    "completed",
  ),
  driverReadyTimeout: runtimeDiagnosticEvent(
    "runtime.driver.ready.timeout",
    "runtime.driver.updated",
    "ready",
    "timed-out",
  ),
  driverRestartAttempted: runtimeDiagnosticEvent(
    "runtime.driver.restart.attempted",
    "runtime.driver.updated",
    "restart",
    "started",
  ),
  provisioningEnvironmentInstallCompleted: runtimeDiagnosticEvent(
    "runtime.provisioning.environment.install.completed",
    "runtime.provisioning.updated",
    "environment.install",
    "completed",
  ),
  provisioningEnvironmentInstallFailed: runtimeDiagnosticEvent(
    "runtime.provisioning.environment.install.failed",
    "runtime.provisioning.updated",
    "environment.install",
    "failed",
  ),
  provisioningEnvironmentInstallStarted: runtimeDiagnosticEvent(
    "runtime.provisioning.environment.install.started",
    "runtime.provisioning.updated",
    "environment.install",
    "started",
  ),
  provisioningEnvironmentResolving: runtimeDiagnosticEvent(
    "runtime.provisioning.environment.resolving",
    "runtime.provisioning.updated",
    "environment.resolve",
    "started",
  ),
  sandboxProvisioningCompleted: runtimeDiagnosticEvent(
    "runtime.sandbox.provisioning.completed",
    "runtime.sandbox.updated",
    "provisioning",
    "completed",
  ),
  sandboxProvisioningFailed: runtimeDiagnosticEvent(
    "runtime.sandbox.provisioning.failed",
    "runtime.sandbox.updated",
    "provisioning",
    "failed",
  ),
  sandboxProvisioningStarted: runtimeDiagnosticEvent(
    "runtime.sandbox.provisioning.started",
    "runtime.sandbox.updated",
    "provisioning",
    "started",
  ),
  sandboxCheckpointFailed: runtimeDiagnosticEvent(
    "runtime.sandbox.checkpoint.failed",
    "runtime.sandbox.updated",
    "checkpoint",
    "failed",
  ),
  sandboxRestoreFailed: runtimeDiagnosticEvent(
    "runtime.sandbox.restore.failed",
    "runtime.sandbox.updated",
    "restore",
    "failed",
  ),
  sandboxSessionDestroyed: runtimeDiagnosticEvent(
    "runtime.sandbox.session.destroyed",
    "runtime.sandbox.updated",
    "session",
    "completed",
  ),
  sandboxTerminated: runtimeDiagnosticEvent(
    "runtime.sandbox.terminated",
    "runtime.sandbox.updated",
    "lifecycle",
    "terminated",
  ),
  transportFileWatchStopped: runtimeDiagnosticEvent(
    "runtime.transport.file.watch.stopped",
    "runtime.transport.updated",
    "file-watch",
    "stopped",
  ),
  transportResyncRequired: runtimeDiagnosticEvent(
    "runtime.transport.resync.required",
    "runtime.transport.updated",
    "websocket",
    "required",
  ),
  transportRpcError: runtimeDiagnosticEvent(
    "runtime.transport.rpc.error",
    "runtime.transport.updated",
    "rpc",
    "failed",
  ),
  transportWsConnected: runtimeDiagnosticEvent(
    "runtime.transport.ws.connected",
    "runtime.transport.updated",
    "websocket",
    "connected",
  ),
  transportWsDisconnected: runtimeDiagnosticEvent(
    "runtime.transport.ws.disconnected",
    "runtime.transport.updated",
    "websocket",
    "disconnected",
  ),
  transportWsReconnectFailed: runtimeDiagnosticEvent(
    "runtime.transport.ws.reconnect.failed",
    "runtime.transport.updated",
    "websocket.reconnect",
    "failed",
  ),
  transportWsReconnectStarted: runtimeDiagnosticEvent(
    "runtime.transport.ws.reconnect.started",
    "runtime.transport.updated",
    "websocket.reconnect",
    "started",
  ),
  transportWsReconnectSucceeded: runtimeDiagnosticEvent(
    "runtime.transport.ws.reconnect.succeeded",
    "runtime.transport.updated",
    "websocket.reconnect",
    "completed",
  ),
} as const;

type RuntimeDiagnosticRegistry = typeof RUNTIME_DIAGNOSTIC_EVENT;
type RuntimeDiagnosticRegistryValue = RuntimeDiagnosticRegistry[keyof RuntimeDiagnosticRegistry];

export type RuntimeDiagnosticEventName = RuntimeDiagnosticRegistryValue["name"];

export interface RuntimeDiagnosticBaseValue {
  readonly agentId: string;
  readonly deploymentVersionId?: string;
  readonly deploymentVersionNumber?: number;
  readonly message?: string | null;
  readonly sessionId: string;
  readonly traceId?: string | null;
}

export interface RuntimeDiagnosticEnvironmentValue extends RuntimeDiagnosticBaseValue {
  readonly environmentRevisionId: string;
}

export interface RuntimeDiagnosticEnvironmentInstallCompletedValue extends RuntimeDiagnosticEnvironmentValue {
  readonly elapsedMs: number;
}

export interface RuntimeDiagnosticEnvironmentInstallFailedValue extends RuntimeDiagnosticEnvironmentValue {
  readonly exitCode?: number | null;
  readonly packageName?: string | null;
  readonly reason: string;
  readonly step?: string | null;
}

export interface RuntimeDiagnosticSandboxValue extends RuntimeDiagnosticBaseValue {
  readonly sandboxId: string;
}

export interface RuntimeDiagnosticSandboxProvisioningCompletedValue extends RuntimeDiagnosticSandboxValue {
  readonly coldStartMs: number;
}

export interface RuntimeDiagnosticSandboxProvisioningFailedValue extends RuntimeDiagnosticSandboxValue {
  readonly errorCode?: string | null;
  readonly reason: string;
}

export interface RuntimeDiagnosticSandboxCheckpointFailedValue extends RuntimeDiagnosticSandboxValue {
  readonly backupId?: string | null;
  readonly dir?: string | null;
  readonly errorCode: string;
  readonly reason: string;
}

export interface RuntimeDiagnosticSandboxRestoreFailedValue extends RuntimeDiagnosticSandboxValue {
  readonly backupId?: string | null;
  readonly errorCode: string;
  readonly reason: string;
}

export interface RuntimeDiagnosticSandboxTerminatedValue extends RuntimeDiagnosticSandboxValue {
  readonly reason: string;
}

export interface RuntimeDiagnosticDriverValue extends RuntimeDiagnosticBaseValue {
  readonly driverInstanceId: string;
}

export interface RuntimeDiagnosticDriverReadyValue extends RuntimeDiagnosticDriverValue {
  readonly port: number;
}

export interface RuntimeDiagnosticDriverLaunchFailedValue extends RuntimeDiagnosticDriverValue {
  readonly exitCode?: number | null;
  readonly reason: string;
}

export interface RuntimeDiagnosticDriverReadyTimeoutValue extends RuntimeDiagnosticDriverValue {
  readonly elapsedMs: number;
  readonly port: number;
}

export interface RuntimeDiagnosticDriverExitedBeforeReadyValue extends RuntimeDiagnosticDriverValue {
  readonly exitCode?: number | null;
}

export interface RuntimeDiagnosticDriverCrashedValue extends RuntimeDiagnosticDriverValue {
  readonly exitCode?: number | null;
  readonly status: string;
  readonly uptimeMs?: number | null;
}

export interface RuntimeDiagnosticDriverRestartAttemptedValue extends RuntimeDiagnosticDriverValue {
  readonly attemptNo: number;
}

export interface RuntimeDiagnosticDriverPortNotRespondingValue extends RuntimeDiagnosticDriverValue {
  readonly errorCode?: string | null;
  readonly port: number;
}

export interface RuntimeDiagnosticTransportWsConnectedValue extends RuntimeDiagnosticDriverValue {
  readonly port: number;
}

export interface RuntimeDiagnosticTransportWsDisconnectedValue extends RuntimeDiagnosticDriverValue {
  readonly closeCode?: number | null;
  readonly closeReason?: string | null;
}

export interface RuntimeDiagnosticTransportWsReconnectStartedValue extends RuntimeDiagnosticDriverValue {
  readonly attemptNo?: number | null;
}

export interface RuntimeDiagnosticTransportWsReconnectFinishedValue extends RuntimeDiagnosticDriverValue {
  readonly elapsedMs: number;
  readonly reason?: string | null;
}

export interface RuntimeDiagnosticTransportRpcErrorValue extends RuntimeDiagnosticDriverValue {
  readonly errorCode: string;
  readonly reason?: string | null;
}

export interface RuntimeDiagnosticTransportFileWatchStoppedValue extends RuntimeDiagnosticBaseValue {
  readonly reason: string;
}

export interface RuntimeDiagnosticTransportResyncRequiredValue extends RuntimeDiagnosticBaseValue {
  readonly reason: string;
}

export interface RuntimeDiagnosticDeploymentVersionAppliedValue extends RuntimeDiagnosticBaseValue {
  readonly deploymentVersionId: string;
  readonly deploymentVersionNumber: number;
}

export interface RuntimeDiagnosticManifestRenderedValue extends RuntimeDiagnosticBaseValue {
  readonly mcpServerCount: number;
  readonly model: string;
  readonly provider: string;
  readonly skillCount: number;
}

export interface RuntimeDiagnosticManifestRenderFailedValue extends RuntimeDiagnosticBaseValue {
  readonly fieldPath: string;
  readonly reason: string;
}

export interface RuntimeDiagnosticCredentialValue extends RuntimeDiagnosticBaseValue {
  readonly provider: string;
}

export interface RuntimeDiagnosticCredentialMissingValue extends RuntimeDiagnosticCredentialValue {
  readonly reason: string;
}

export interface RuntimeDiagnosticMountSucceededValue extends RuntimeDiagnosticBaseValue {
  readonly mountPath: string;
  readonly spaceId: string;
}

export interface RuntimeDiagnosticMountFailedValue extends RuntimeDiagnosticMountSucceededValue {
  readonly reason: string;
}

export interface RuntimeDiagnosticEventValueByName {
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configCredentialMissing
    .name]: RuntimeDiagnosticCredentialMissingValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configCredentialResolved
    .name]: RuntimeDiagnosticCredentialValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configDeploymentVersionApplied
    .name]: RuntimeDiagnosticDeploymentVersionAppliedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configManifestRenderFailed
    .name]: RuntimeDiagnosticManifestRenderFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configManifestRendered
    .name]: RuntimeDiagnosticManifestRenderedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configMountFailed.name]: RuntimeDiagnosticMountFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.configMountSucceeded
    .name]: RuntimeDiagnosticMountSucceededValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverCrashed.name]: RuntimeDiagnosticDriverCrashedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverExitedBeforeReady
    .name]: RuntimeDiagnosticDriverExitedBeforeReadyValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverLaunchFailed
    .name]: RuntimeDiagnosticDriverLaunchFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverLaunchStarted.name]: RuntimeDiagnosticDriverValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverPortNotResponding
    .name]: RuntimeDiagnosticDriverPortNotRespondingValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverReady.name]: RuntimeDiagnosticDriverReadyValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverReadyTimeout
    .name]: RuntimeDiagnosticDriverReadyTimeoutValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.driverRestartAttempted
    .name]: RuntimeDiagnosticDriverRestartAttemptedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentInstallCompleted
    .name]: RuntimeDiagnosticEnvironmentInstallCompletedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentInstallFailed
    .name]: RuntimeDiagnosticEnvironmentInstallFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentInstallStarted
    .name]: RuntimeDiagnosticEnvironmentValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentResolving
    .name]: RuntimeDiagnosticEnvironmentValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxProvisioningCompleted
    .name]: RuntimeDiagnosticSandboxProvisioningCompletedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxProvisioningFailed
    .name]: RuntimeDiagnosticSandboxProvisioningFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxProvisioningStarted
    .name]: RuntimeDiagnosticSandboxValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxCheckpointFailed
    .name]: RuntimeDiagnosticSandboxCheckpointFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxRestoreFailed
    .name]: RuntimeDiagnosticSandboxRestoreFailedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxSessionDestroyed
    .name]: RuntimeDiagnosticSandboxTerminatedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.sandboxTerminated
    .name]: RuntimeDiagnosticSandboxTerminatedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportFileWatchStopped
    .name]: RuntimeDiagnosticTransportFileWatchStoppedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportResyncRequired
    .name]: RuntimeDiagnosticTransportResyncRequiredValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportRpcError
    .name]: RuntimeDiagnosticTransportRpcErrorValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportWsConnected
    .name]: RuntimeDiagnosticTransportWsConnectedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportWsDisconnected
    .name]: RuntimeDiagnosticTransportWsDisconnectedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportWsReconnectFailed
    .name]: RuntimeDiagnosticTransportWsReconnectFinishedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportWsReconnectStarted
    .name]: RuntimeDiagnosticTransportWsReconnectStartedValue;
  readonly [RUNTIME_DIAGNOSTIC_EVENT.transportWsReconnectSucceeded
    .name]: RuntimeDiagnosticTransportWsReconnectFinishedValue;
}

export type RuntimeDiagnosticEventValue<TName extends RuntimeDiagnosticEventName> =
  RuntimeDiagnosticEventValueByName[TName];

const runtimeDiagnosticEventByName = new Map<string, RuntimeDiagnosticEventDefinition>(
  Object.values(RUNTIME_DIAGNOSTIC_EVENT).map((event) => [event.name, event]),
);

export function readRuntimeDiagnosticEventDefinition(
  name: RuntimeDiagnosticEventName,
): RuntimeDiagnosticEventDefinition {
  const definition = runtimeDiagnosticEventByName.get(name);

  if (definition === undefined) {
    throw new Error(`Unknown runtime diagnostic event: ${name}`);
  }

  return definition;
}

export interface RuntimeDiagnosticEventIngressInput<
  TName extends RuntimeDiagnosticEventName = RuntimeDiagnosticEventName,
> {
  readonly eventName: TName;
  readonly value: RuntimeDiagnosticEventValue<TName>;
}

export function ingestRuntimeDiagnosticEvent<TName extends RuntimeDiagnosticEventName>(
  context: RuntimeEventBuildContext,
  input: RuntimeDiagnosticEventIngressInput<TName>,
): RuntimeEventIngressOutcome {
  const definition = readRuntimeDiagnosticEventDefinition(input.eventName);

  return ingestRuntimeEventInput(
    {
      ...context,
      origin: "system",
    },
    {
      actor: "system",
      kind: definition.kind,
      payload: createRuntimeDiagnosticPayload(definition, input.value),
      visibility: "owner_debug",
    },
  );
}

function createRuntimeDiagnosticPayload(
  definition: RuntimeDiagnosticEventDefinition,
  detail: unknown,
):
  | { readonly channel: string; readonly detail: unknown; readonly status: string }
  | { readonly detail: unknown; readonly phase: string; readonly status: string } {
  if (definition.kind === "runtime.transport.updated") {
    return {
      channel: definition.phase,
      detail,
      status: definition.status,
    };
  }

  return {
    detail,
    phase: definition.phase,
    status: definition.status,
  };
}
