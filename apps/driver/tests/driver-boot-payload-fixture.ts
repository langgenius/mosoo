import { DRIVER_CONTROL_PORT_MIN } from "@mosoo/driver-protocol";
import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
} from "@mosoo/driver-protocol";

export const DRIVER_TEST_IDS = {
  agentId: "01J00000000000000000000009",
  callerAccountId: "01J00000000000000000000001",
  cloudflareSessionId: "01J0000000000000000000000E",
  driverInstanceId: "01J0000000000000000000000F",
  environmentId: "01J00000000000000000000010",
  environmentRevisionId: "01J00000000000000000000011",
  runId: "01J00000000000000000000012",
  sandboxId: "01J0000000000000000000000D",
  secondRunId: "01J00000000000000000000013",
  sessionId: "01J00000000000000000000008",
  spaceId: "01J00000000000000000000014",
  thirdRunId: "01J00000000000000000000015",
} as const;

export const driverBootPayload = {
  bootToken: "boot-token",
  driverControlPort: DRIVER_CONTROL_PORT_MIN,
  driverGeneration: 0,
  driverInstanceId: DRIVER_TEST_IDS.driverInstanceId,
  execution: {
    configRevision: {
      agentId: DRIVER_TEST_IDS.agentId,
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      environmentId: DRIVER_TEST_IDS.environmentId,
      environmentRevisionId: DRIVER_TEST_IDS.environmentRevisionId,
      runId: DRIVER_TEST_IDS.runId,
      sessionId: DRIVER_TEST_IDS.sessionId,
    },
    environment: {
      variables: {},
    },
    model: "model-1",
    profilePrompt: "",
    provider: "provider-1",
    session: {
      additionalDirectories: [],
      context: {
        cloudflareSessionId: DRIVER_TEST_IDS.cloudflareSessionId,
        homePath: "/tmp/home",
        organizationAccessSnapshot: {
          entries: [],
        },
        origin: {
          callerUserId: DRIVER_TEST_IDS.callerAccountId,
          entrypoint: "api",
          executionOwnerUserId: DRIVER_TEST_IDS.callerAccountId,
          type: "agent",
        },
        sandboxId: DRIVER_TEST_IDS.sandboxId,
        sandboxKind: "cattle",
        sandboxSubjectId: DRIVER_TEST_IDS.sessionId,
        sandboxSubjectKind: "session",
        sessionOrganizationPath: "/tmp/organization",
        spaceAliases: [],
      },
      cwd: "/tmp/organization",
      mcpServers: [],
      nativeResumeRef: null,
    },
    skillCatalog: [],
    skills: [],
  },
  heartbeatIntervalMs: 1_000,
  protocolVersion: 1,
  runtime: "openai-runtime",
  runtimeTransport: "openai-app-server",
  sandboxId: DRIVER_TEST_IDS.sandboxId,
  traceparent: "00-00000000000000000000000000000001-0000000000000001-01",
} satisfies DriverBootPayload;

export const driverTestAccessSnapshot = {
  entries: [
    {
      mountPath: "/workspace/docs",
      role: "read",
      spaceId: DRIVER_TEST_IDS.spaceId,
      type: "space",
    },
  ],
} satisfies DriverOrganizationAccessSnapshotOutput;
