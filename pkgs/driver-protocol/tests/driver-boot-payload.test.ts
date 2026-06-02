import { describe, expect, test } from "bun:test";

import { MCP_UNAVAILABLE_AUTHORIZATION_STATES } from "@mosoo/contracts/mcp";
import type {
  UnavailableMcpAuthorizationState,
  UnavailableMcpCredentialStatus,
} from "@mosoo/contracts/mcp";
import { DRIVER_CONTROL_PORT_MIN, parseDriverBootPayload } from "@mosoo/driver-protocol";

const FIXTURE_GLOBAL_SPACE_PATH = "/fixture-space/docs";
const FIXTURE_HOME_PATH = "/fixture-home";
const FIXTURE_ORGANIZATION_PATH = "/fixture-organization";
const FIXTURE_SPACE_ALIAS_PATH = "/fixture-alias/docs";
const FIXTURE_SKILL_MOUNT_PATH = "/fixture-skills/review";

const lowerCasePayload = {
  bootToken: "boot-token",
  driverControlPort: DRIVER_CONTROL_PORT_MIN,
  driverGeneration: 0,
  driverInstanceId: "01j0000000000000000000000f",
  execution: {
    configRevision: {
      agentId: "01j00000000000000000000009",
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      environmentId: "01j00000000000000000000010",
      environmentRevisionId: "01j00000000000000000000011",
      runId: "01j00000000000000000000012",
      sessionId: "01j00000000000000000000008",
    },
    environment: {
      variables: {},
    },
    model: "provider-native-model",
    profilePrompt: "",
    provider: "provider-native-id",
    session: {
      additionalDirectories: [],
      context: {
        cloudflareSessionId: "01j0000000000000000000000e",
        homePath: FIXTURE_HOME_PATH,
        organizationAccessSnapshot: {
          entries: [
            {
              mountPath: FIXTURE_SPACE_ALIAS_PATH,
              role: "read",
              spaceId: "01j00000000000000000000014",
              type: "space",
            },
          ],
        },
        origin: {
          callerUserId: "01j00000000000000000000001",
          entrypoint: "api",
          executionOwnerUserId: "01j00000000000000000000001",
          type: "agent",
        },
        sandboxId: "01j0000000000000000000000d",
        sandboxKind: "cattle",
        sandboxSubjectId: "01j00000000000000000000008",
        sandboxSubjectKind: "session",
        sessionOrganizationPath: FIXTURE_ORGANIZATION_PATH,
        spaceAliases: [
          {
            aliasPath: FIXTURE_SPACE_ALIAS_PATH,
            globalMountPath: FIXTURE_GLOBAL_SPACE_PATH,
            spaceId: "01j00000000000000000000014",
            spaceName: "Docs",
          },
        ],
      },
      cwd: FIXTURE_ORGANIZATION_PATH,
      mcpServers: [
        {
          authType: "oauth",
          authorizationState: "active",
          credentialId: "01j00000000000000000000016",
          credentialScope: "user",
          credentialStatus: "active",
          name: "Linear",
          proxyGrantId: "grant-1",
          proxyUrl: "https://api.example.com/api/driver/mcp/proxy/01j00000000000000000000017",
          serverId: "01j00000000000000000000017",
          subjectLabel: "Evan",
        },
        {
          authType: "bearer",
          authorizationState: "authorization_required",
          credentialScope: "organization_shared",
          credentialStatus: "none",
          name: "Docs",
          serverId: "01j00000000000000000000018",
          subjectLabel: null,
        },
      ],
      nativeResumeRef: {
        kind: "openai_thread_id",
        runtimeId: "openai-runtime",
        value: "provider-thread-ref",
      },
    },
    skillCatalog: [
      {
        frontmatter: {
          author: "Platform",
          description: "Inspect code boundaries.",
          version: "1.0.0",
        },
        mountPath: FIXTURE_SKILL_MOUNT_PATH,
        resolutionMode: "explicit",
        skillId: "01j00000000000000000000019",
        skillName: "review",
      },
    ],
    skills: [
      {
        archiveFormat: "zip",
        blobSha256: "sha256-1",
        compression: "deflate",
        downloadUrl: "https://api.example.com/api/driver/skill/01j0000000000000000000001a/package",
        materializationStatus: "ready",
        mountPath: FIXTURE_SKILL_MOUNT_PATH,
        resolutionMode: "explicit",
        skillId: "01j00000000000000000000019",
        skillName: "review",
        snapshotId: "01j0000000000000000000001a",
        warningCode: null,
      },
    ],
  },
  heartbeatIntervalMs: 1_000,
  protocolVersion: 1,
  runtime: "openai-runtime",
  runtimeTransport: "openai-app-server",
  sandboxId: "01j0000000000000000000000d",
  traceparent: "00-00000000000000000000000000000001-0000000000000001-01",
} as const;

const UNAVAILABLE_CREDENTIAL_STATUS_BY_AUTHORIZATION_STATE = {
  authorization_required: "none",
  disabled: "none",
  expired: "expired",
  revoked: "revoked",
} as const satisfies Record<UnavailableMcpAuthorizationState, UnavailableMcpCredentialStatus>;

function payloadWithMcpServers(mcpServers: readonly unknown[]): unknown {
  return {
    ...lowerCasePayload,
    execution: {
      ...lowerCasePayload.execution,
      session: {
        ...lowerCasePayload.execution.session,
        mcpServers,
      },
    },
  };
}

describe("driver boot payload", () => {
  test("normalizes platform IDs while keeping provider-native strings opaque", () => {
    const payload = parseDriverBootPayload(lowerCasePayload);

    expect(payload.driverInstanceId).toBe("01J0000000000000000000000F");
    expect(payload.sandboxId).toBe("01J0000000000000000000000D");
    expect(payload.execution.configRevision).toMatchObject({
      agentId: "01J00000000000000000000009",
      environmentId: "01J00000000000000000000010",
      environmentRevisionId: "01J00000000000000000000011",
      runId: "01J00000000000000000000012",
      sessionId: "01J00000000000000000000008",
    });
    expect(payload.execution.session.context).toMatchObject({
      cloudflareSessionId: "01J0000000000000000000000E",
      sandboxId: "01J0000000000000000000000D",
      sandboxSubjectId: "01J00000000000000000000008",
    });
    expect(payload.execution.session.context.organizationAccessSnapshot.entries[0]?.spaceId).toBe(
      "01J00000000000000000000014",
    );
    expect(payload.execution.session.context.spaceAliases[0]?.spaceId).toBe(
      "01J00000000000000000000014",
    );
    expect(payload.execution.session.mcpServers[0]).toMatchObject({
      credentialId: "01J00000000000000000000016",
      serverId: "01J00000000000000000000017",
    });
    expect(payload.execution.session.mcpServers[1]).toMatchObject({
      serverId: "01J00000000000000000000018",
    });
    expect(payload.execution.skillCatalog[0]?.skillId).toBe("01J00000000000000000000019");
    expect(payload.execution.skills[0]).toMatchObject({
      skillId: "01J00000000000000000000019",
      snapshotId: "01J0000000000000000000001A",
    });
    expect(payload.execution.provider).toBe("provider-native-id");
    expect(payload.execution.model).toBe("provider-native-model");
    expect(payload.execution.session.nativeResumeRef?.value).toBe("provider-thread-ref");
  });

  test("admits MCP boot states from the contract owner", () => {
    const authorized = parseDriverBootPayload(
      payloadWithMcpServers([lowerCasePayload.execution.session.mcpServers[0]]),
    );

    expect(authorized.execution.session.mcpServers[0]).toMatchObject({
      authorizationState: "active",
      credentialStatus: "active",
    });

    for (const authorizationState of MCP_UNAVAILABLE_AUTHORIZATION_STATES) {
      const credentialStatus =
        UNAVAILABLE_CREDENTIAL_STATUS_BY_AUTHORIZATION_STATE[authorizationState];
      const payload = parseDriverBootPayload(
        payloadWithMcpServers([
          {
            ...lowerCasePayload.execution.session.mcpServers[1],
            authorizationState,
            credentialStatus,
          },
        ]),
      );

      expect(payload.execution.session.mcpServers[0]).toMatchObject({
        authorizationState,
        credentialStatus,
      });
    }
  });

  test("rejects widened MCP boot state values", () => {
    expect(() =>
      parseDriverBootPayload(
        payloadWithMcpServers([
          {
            ...lowerCasePayload.execution.session.mcpServers[1],
            authorizationState: "authorized",
            credentialStatus: "configured",
          },
        ]),
      ),
    ).toThrow();

    expect(() =>
      parseDriverBootPayload(
        payloadWithMcpServers([
          {
            ...lowerCasePayload.execution.session.mcpServers[1],
            authorizationState: "disabled",
            credentialStatus: "active",
          },
        ]),
      ),
    ).toThrow();
  });

  test("rejects malformed platform IDs before the driver starts", () => {
    expect(() =>
      parseDriverBootPayload({
        ...lowerCasePayload,
        driverInstanceId: "driver-instance-1",
      }),
    ).toThrow();
  });

  test("rejects malformed boot payload resource IDs before the driver starts", () => {
    expect(() =>
      parseDriverBootPayload({
        ...lowerCasePayload,
        execution: {
          ...lowerCasePayload.execution,
          session: {
            ...lowerCasePayload.execution.session,
            mcpServers: [
              {
                ...lowerCasePayload.execution.session.mcpServers[0],
                credentialId: "credential-1",
              },
            ],
          },
        },
      }),
    ).toThrow();

    expect(() =>
      parseDriverBootPayload({
        ...lowerCasePayload,
        execution: {
          ...lowerCasePayload.execution,
          session: {
            ...lowerCasePayload.execution.session,
            mcpServers: [
              {
                ...lowerCasePayload.execution.session.mcpServers[1],
                serverId: "mcp-docs",
              },
            ],
          },
        },
      }),
    ).toThrow();

    expect(() =>
      parseDriverBootPayload({
        ...lowerCasePayload,
        execution: {
          ...lowerCasePayload.execution,
          skills: [
            {
              ...lowerCasePayload.execution.skills[0],
              skillId: "skill-1",
            },
          ],
        },
      }),
    ).toThrow();

    expect(() =>
      parseDriverBootPayload({
        ...lowerCasePayload,
        execution: {
          ...lowerCasePayload.execution,
          skills: [
            {
              ...lowerCasePayload.execution.skills[0],
              snapshotId: "snapshot-1",
            },
          ],
        },
      }),
    ).toThrow();
  });
});
