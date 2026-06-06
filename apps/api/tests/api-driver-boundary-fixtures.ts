import type {
  DriverEvent,
  DriverProfileConfig,
  DriverResolvedMcpServer,
  DriverResolvedSkill,
  DriverSkillCatalogEntry,
} from "@mosoo/driver-protocol";
import { parsePlatformId } from "@mosoo/id";
import type {
  CredentialId,
  McpServerId,
  SandboxSessionId,
  SkillId,
  SkillSnapshotId,
} from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import { toRuntimeEventInput } from "@mosoo/runtime-events";

import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";

export const API_DRIVER_BOUNDARY_IDS = {
  account: PLATFORM_ID_FIXTURES.account,
  agent: PLATFORM_ID_FIXTURES.agent,
  cloudflareSession: "01J0000000000000000000000S" as SandboxSessionId,
  deploymentVersion: PLATFORM_ID_FIXTURES.agentDeploymentVersion,
  driverInstance: PLATFORM_ID_FIXTURES.driverInstance,
  environment: PLATFORM_ID_FIXTURES.environment,
  environmentRevision: PLATFORM_ID_FIXTURES.environmentRevision,
  mcpCredential: parsePlatformId<CredentialId>("01J0000000000000000000000V"),
  mcpServerDocs: parsePlatformId<McpServerId>("01J0000000000000000000000W"),
  mcpServerLinear: parsePlatformId<McpServerId>("01J0000000000000000000000X"),
  organization: PLATFORM_ID_FIXTURES.organization,
  runtimeEvent: PLATFORM_ID_FIXTURES.runtimeEvent,
  sandbox: PLATFORM_ID_FIXTURES.sandbox,
  session: PLATFORM_ID_FIXTURES.session,
  sessionRun: PLATFORM_ID_FIXTURES.sessionRun,
  skill: PLATFORM_ID_FIXTURES.skill,
  skillSnapshot: parsePlatformId<SkillSnapshotId>("01J0000000000000000000000Y"),
  tombstoneSkill: parsePlatformId<SkillId>("01J0000000000000000000000Z"),
  space: PLATFORM_ID_FIXTURES.space,
} as const;

export function createDriverProfile(): DriverProfileConfig {
  return {
    agentId: API_DRIVER_BOUNDARY_IDS.agent,
    configRevision: {
      agentId: API_DRIVER_BOUNDARY_IDS.agent,
      deploymentVersionId: API_DRIVER_BOUNDARY_IDS.deploymentVersion,
      deploymentVersionNumber: 3,
      environmentId: API_DRIVER_BOUNDARY_IDS.environment,
      environmentRevisionId: API_DRIVER_BOUNDARY_IDS.environmentRevision,
      runId: null,
      sessionId: API_DRIVER_BOUNDARY_IDS.session,
    },
    envVarNames: ["EXISTING_ENV"],
    envVars: {
      EXISTING_ENV: "kept",
    },
    kind: "cattle",
    model: "gpt-5.1",
    prompt: "You are a helpful runtime.",
    provider: "openai",
    readiness: {
      checkedAt: "2026-05-19T00:00:00.000Z",
      issues: [],
      ready: true,
    },
    runtimeId: "openai-runtime",
    sandbox: {
      id: API_DRIVER_BOUNDARY_IDS.sandbox,
      kind: "cattle",
      subjectId: API_DRIVER_BOUNDARY_IDS.session,
      subjectKind: "session",
    },
    session: {
      cloudflareSessionId: API_DRIVER_BOUNDARY_IDS.cloudflareSession,
      homePath: "/home/agent",
      origin: {
        callerUserId: API_DRIVER_BOUNDARY_IDS.account,
        entrypoint: "api",
        executionOwnerUserId: API_DRIVER_BOUNDARY_IDS.account,
        type: "agent",
      },
      sessionOrganizationPath: "/organization",
      spaceAliases: [
        {
          aliasPath: "/workspace/docs",
          globalMountPath: "/organization/spaces/docs",
          spaceId: API_DRIVER_BOUNDARY_IDS.space,
          spaceName: "Docs",
        },
      ],
    },
    setupScript: "",
    sourceKind: "agent",
  };
}

export function createResolvedMcpServers(): DriverResolvedMcpServer[] {
  return [
    {
      authType: "oauth",
      authorizationState: "active",
      credentialId: API_DRIVER_BOUNDARY_IDS.mcpCredential,
      credentialScope: "user",
      credentialStatus: "active",
      name: "Linear",
      serverId: API_DRIVER_BOUNDARY_IDS.mcpServerLinear,
      subjectLabel: "Evan",
    },
    {
      authType: "bearer",
      authorizationState: "authorization_required",
      credentialScope: "organization_shared",
      credentialStatus: "none",
      name: "Docs",
      serverId: API_DRIVER_BOUNDARY_IDS.mcpServerDocs,
      subjectLabel: null,
    },
  ];
}

export function createResolvedSkillCatalog(): DriverSkillCatalogEntry[] {
  return [
    {
      frontmatter: {
        author: "Platform",
        description: "Inspect code boundaries.",
        version: "1.0.0",
      },
      mountPath: "/skills/review",
      resolutionMode: "explicit",
      skillId: PLATFORM_ID_FIXTURES.skill,
      skillName: "review",
    },
  ];
}

export function createResolvedSkills(): Omit<DriverResolvedSkill, "downloadUrl">[] {
  return [
    {
      archiveFormat: "zip",
      blobSha256: "sha256-1",
      compression: "deflate",
      materializationStatus: "ready",
      mountPath: "/skills/review",
      resolutionMode: "explicit",
      skillId: PLATFORM_ID_FIXTURES.skill,
      skillName: "review",
      snapshotId: API_DRIVER_BOUNDARY_IDS.skillSnapshot,
      warningCode: null,
    },
    {
      archiveFormat: "zip",
      blobSha256: "sha256-tombstone",
      compression: "deflate",
      materializationStatus: "skipped",
      mountPath: "/skills/removed",
      resolutionMode: "tombstone",
      skillId: API_DRIVER_BOUNDARY_IDS.tombstoneSkill,
      skillName: "removed",
      snapshotId: null,
      warningCode: "skill_removed",
    },
  ];
}

export function createDriverEvent(value: object): DriverEvent {
  const [event] = toRuntimeEventInput(
    {
      createId: () => API_DRIVER_BOUNDARY_IDS.runtimeEvent,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      occurredAt: "1970-01-01T00:00:00.010Z",
      sessionId: API_DRIVER_BOUNDARY_IDS.session,
    },
    value,
  );

  if (event === undefined) {
    throw new Error("Expected a runtime event.");
  }

  return event;
}

export function createRuntimeSessionLink(): RuntimeSessionLink {
  return {
    agentId: API_DRIVER_BOUNDARY_IDS.agent,
    callerId: API_DRIVER_BOUNDARY_IDS.account,
    creatorId: API_DRIVER_BOUNDARY_IDS.account,
    executionOwnerId: API_DRIVER_BOUNDARY_IDS.account,
    organizationId: API_DRIVER_BOUNDARY_IDS.organization,
    sandboxId: API_DRIVER_BOUNDARY_IDS.sandbox,
    sandboxKind: "cattle",
    sandboxSubjectKind: "session",
    sessionId: API_DRIVER_BOUNDARY_IDS.session,
    sessionRunId: API_DRIVER_BOUNDARY_IDS.sessionRun,
    sessionRunStatus: "running",
    traceId: "trace-1",
  };
}
