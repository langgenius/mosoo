import type { SessionSummary } from "@mosoo/contracts/session";
import {
  accountsTable,
  agentDeploymentVersionsTable,
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  organizationsTable,
  personalAccessTokensTable,
  sandboxSessionsTable,
  sandboxesTable,
  projectsTable,
  sessionExecutionSnapshotsTable,
  sessionsTable,
  vendorCredentialsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  ProjectId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  VendorCredentialId,
} from "@mosoo/id";

import { hashTokenValue } from "../../src/modules/auth/application/personal-access-token.service";
import { storeVendorCredentialSecret } from "../../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../../src/platform/cloudflare/worker-types";
import type { ApiCommandQueueStub } from "./api-command-queue-fixture";
import { createApiCommandQueueStub } from "./api-command-queue-fixture";
import {
  applyDrizzleMigrations,
  applyDrizzleMigrationsFrom,
  applyDrizzleMigrationsThrough,
} from "./drizzle-migrations";
import { SqliteD1Database } from "./sqlite-d1";
export { SqliteD1Database } from "./sqlite-d1";
export {
  createApiCommandQueueStub,
  createRecordedQueueMessage,
  type ApiCommandQueueStub,
  type CapturedApiCommandMessage,
  type RecordedQueueMessage,
  type RecordedQueueMessageAction,
} from "./api-command-queue-fixture";

const INITIAL_AGENT_CONFIG_JSON = JSON.stringify({
  packageMcpServers: [],
  packageResolution: null,
  packageSkills: [],
});

export const PUBLIC_API_TEST_IDS = {
  agent: "01J00000000000000000000009",
  legacyGrantAccount: "01J00000000000000000000003",
  deployment: "01J0000000000000000000000A",
  disabledAccount: "01J00000000000000000000004",
  environment: "01J00000000000000000000007",
  environmentRevision: "01J00000000000000000000008",
  file: "01J0000000000000000000000J",
  fileAlt: "01J0000000000000000000000K",
  nonOwnerAccount: "01J00000000000000000000002",
  nonOwnerSession: "01J0000000000000000000000B",
  operation: "01J0000000000000000000000R",
  organization: "01J00000000000000000000006",
  outsiderAccount: "01J00000000000000000000005",
  ownerAccount: "01J00000000000000000000001",
  ownerSession: "01J0000000000000000000000C",
  patLegacyGrant: "01J00000000000000000000063",
  patDisabled: "01J00000000000000000000064",
  patNonOwner: "01J00000000000000000000062",
  patOutsider: "01J00000000000000000000065",
  patOwner: "01J00000000000000000000061",
  patRevoked: "01J00000000000000000000066",
  project: "01J0000000000000000000000Q",
  run: "01J0000000000000000000000N",
  runAlt: "01J0000000000000000000000P",
  sandbox: "01J0000000000000000000000D",
  driverNonOwner: "01J0000000000000000000000E",
  driverOwner: "01J0000000000000000000000F",
} as const;

const PUBLIC_API_VENDOR_CREDENTIAL_ID = "01J0000000000000000000000S" as VendorCredentialId;

export function createTestExecutionContext(): ExecutionContext {
  return {
    exports: unavailableBinding<Cloudflare.Exports>("ExecutionContext.exports"),
    passThroughOnException: () => {},
    props: undefined,
    waitUntil: (_promise: Promise<unknown>) => {},
  };
}

export const TOKENS = {
  legacyGrant: "mst_legacy_grant_public_http_token_01",
  disabled: "mst_disabled_public_http_token_01",
  nonOwner: "mst_non_owner_public_http_token_01",
  outsider: "mst_outsider_public_http_token_01",
  owner: "mst_owner_public_http_token_01",
  revoked: "mst_revoked_public_http_token_01",
} as const;

export function nowMsForTest(): number {
  return Date.parse("2026-05-08T00:00:00.000Z");
}

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  customMetadata: Record<string, string>;
  etag: string;
  key: string;
}

export class PublicApiMemoryFileBucket {
  readonly objects = new Map<string, StoredObject>();
  #nextEtag = 1;

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.#toObjectBody(stored);
  }

  async head(key: string): Promise<R2Object | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.#toObject(stored);
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const bytes = await this.#readBody(body);
    const existing = this.objects.get(key);
    const ifNoneMatch = this.#readOnlyIfHeader(options?.onlyIf, "If-None-Match");
    const ifMatch = this.#readOnlyIfHeader(options?.onlyIf, "If-Match");

    if (ifNoneMatch === "*" && existing !== undefined) {
      return null;
    }

    if (ifMatch !== null && existing?.etag !== ifMatch.replaceAll('"', "")) {
      return null;
    }

    const stored: StoredObject = {
      body: bytes,
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
      customMetadata: { ...options?.customMetadata },
      etag: this.#createEtag(),
      key,
    };

    this.objects.set(key, stored);
    return this.#toObject(stored);
  }

  #createEtag(): string {
    const etag = `etag-${this.#nextEtag}`;
    this.#nextEtag += 1;
    return etag;
  }

  async #readBody(
    body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob | null,
  ): Promise<Uint8Array> {
    if (body === null) {
      return new Uint8Array();
    }

    if (typeof body === "string") {
      return new TextEncoder().encode(body);
    }

    if (body instanceof Blob) {
      return new Uint8Array(await body.arrayBuffer());
    }

    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body).slice();
    }

    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
    }

    const chunks: Uint8Array[] = [];
    const reader = body.getReader();

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      chunks.push(result.value);
    }

    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return bytes;
  }

  #readOnlyIfHeader(onlyIf: R2PutOptions["onlyIf"] | undefined, name: string): string | null {
    return onlyIf instanceof Headers ? onlyIf.get(name) : null;
  }

  #toObject(stored: StoredObject): R2Object {
    return {
      customMetadata: { ...stored.customMetadata },
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: {
        contentType: stored.contentType,
      },
      key: stored.key,
      size: stored.body.byteLength,
      uploaded: new Date(0),
      version: "",
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", stored.contentType);
      },
    } as R2Object;
  }

  #toObjectBody(stored: StoredObject): R2ObjectBody {
    const bytes = stored.body.slice();

    return {
      ...this.#toObject(stored),
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async blob() {
        return new Blob([bytes], { type: stored.contentType });
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      bodyUsed: false,
      async json<T>() {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      },
      async text() {
        return new TextDecoder().decode(bytes);
      },
    } as R2ObjectBody;
  }
}

export function createPublicHttpTestBindings(
  database: D1Database,
  options: {
    apiCommandQueue?: ApiCommandQueueStub;
    fileBucket?: R2Bucket;
    sessionNamespace?: ApiBindings["Session"];
  } = {},
): Record<string, unknown> {
  return {
    APP_NAME: "mosoo",
    AUTH_EMAIL: unavailableBinding<SendEmail>("AUTH_EMAIL"),
    AUTH_EMAIL_FROM: "mosoo AUTH <auth@mosoo.ai>",
    BETTER_AUTH_SECRET: "test-secret",
    API_COMMAND_QUEUE: options.apiCommandQueue ?? createApiCommandQueueStub(),
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    DB: database,
    FILE_BUCKET: options.fileBucket ?? unavailableBinding<R2Bucket>("FILE_BUCKET"),
    FILE_BUCKET_NAME: "mosoo-file",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    RUNTIME_ACTION_TOKEN_SECRET: "test-runtime-action-token",
    SANDBOX_FILE_BUCKET_LOCAL: "true",
    SANDBOX_STATE_BUCKET: unavailableBinding<R2Bucket>("SANDBOX_STATE_BUCKET"),
    SANDBOX_STATE_BUCKET_NAME: "mosoo-sandbox-state",
    Session: options.sessionNamespace ?? createOkDurableObjectNamespace(),
    VAULT_ROOT_SECRET: "test-vault-secret",
    WEB_ORIGIN: "https://mosoo.ai",
  };
}

export function migratePre0015PublicHttpContractDatabase(database: SqliteD1Database): void {
  applyDrizzleMigrationsFrom(database, "0015_session-event-stream-identity");
}

async function seedPublicHttpContractDatabase(
  database: SqliteD1Database,
): Promise<SqliteD1Database> {
  const nowMs = nowMsForTest();

  const db = database.app();
  await db
    .insert(accountsTable)
    .values(
      [
        [PUBLIC_API_TEST_IDS.ownerAccount, "owner@example.com", "Owner"],
        [PUBLIC_API_TEST_IDS.nonOwnerAccount, "non-owner@example.com", "Non Owner"],
        [PUBLIC_API_TEST_IDS.legacyGrantAccount, "legacy-grant@example.com", "Legacy Grant"],
        [PUBLIC_API_TEST_IDS.disabledAccount, "disabled@example.com", "Disabled"],
        [PUBLIC_API_TEST_IDS.outsiderAccount, "outsider@example.com", "Outsider"],
      ].map(([id, email, name]) => ({
        createdAt: nowMs,
        email,
        emailVerified: true,
        id,
        image: null,
        lastActiveOrganizationId: null,
        name,
        systemAgentModel: null,
        updatedAt: nowMs,
      })),
    )
    .run();

  await db
    .insert(organizationsTable)
    .values({
      avatarUrl: null,
      createdAt: nowMs,
      creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      id: PUBLIC_API_TEST_IDS.organization,
      name: "mosoo Test Org",
      updatedAt: nowMs,
    })
    .run();

  await db
    .insert(projectsTable)
    .values({
      createdAt: nowMs,
      defaultEnvironmentId: PUBLIC_API_TEST_IDS.environment,
      id: PUBLIC_API_TEST_IDS.project,
      name: "Default Project",
      organizationId: PUBLIC_API_TEST_IDS.organization,
      ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      updatedAt: nowMs,
    })
    .run();

  await db
    .insert(environmentRevisionsTable)
    .values({
      allowMcpServers: true,
      allowPackageManagers: true,
      allowedHostsJson: "[]",
      createdAt: nowMs,
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      envVarsJson: "[]",
      environmentId: PUBLIC_API_TEST_IDS.environment,
      id: PUBLIC_API_TEST_IDS.environmentRevision,
      networkPolicy: "full",
      packagesJson: "[]",
      projectId: PUBLIC_API_TEST_IDS.project,
      setupScript: "",
    })
    .run();

  await db
    .insert(environmentsTable)
    .values({
      createdAt: nowMs,
      currentRevisionId: PUBLIC_API_TEST_IDS.environmentRevision,
      description: "",
      forkedFromEnvironmentId: null,
      forkedFromEnvironmentName: null,
      forkedFromOwnerName: null,
      id: PUBLIC_API_TEST_IDS.environment,
      name: "Default",
      ownerAccountId: null,
      projectId: PUBLIC_API_TEST_IDS.project,
      updatedAt: nowMs,
    })
    .run();

  const apiKeySecretId = await storeVendorCredentialSecret(
    createPublicHttpTestBindings(database) as ApiBindings,
    {
      apiKey: "sk-test",
      credentialId: PUBLIC_API_VENDOR_CREDENTIAL_ID,
      projectId: PUBLIC_API_TEST_IDS.project,
      providerId: "openai",
      purpose: "credential_create_api_key",
    },
  );

  await db
    .insert(vendorCredentialsTable)
    .values({
      apiBase: null,
      apiKeySecretId,
      createdAt: nowMs,
      id: PUBLIC_API_VENDOR_CREDENTIAL_ID,
      models: null,
      name: "Project OpenAI",
      projectId: PUBLIC_API_TEST_IDS.project,
      updatedAt: nowMs,
      vendorId: "openai",
    })
    .run();

  await db
    .insert(agentsTable)
    .values({
      configJson: INITIAL_AGENT_CONFIG_JSON,
      createdAt: nowMs,
      description: null,
      environmentId: PUBLIC_API_TEST_IDS.environment,
      id: PUBLIC_API_TEST_IDS.agent,
      kind: "pet",
      liveDeploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      model: "gpt-5.4",
      name: "Public API Agent",
      ownerId: PUBLIC_API_TEST_IDS.ownerAccount,
      prompt: "Help.",
      provider: "openai",
      projectId: PUBLIC_API_TEST_IDS.project,
      runtimeId: "openai-runtime",
      status: "published",
      updatedAt: nowMs,
      visibility: "private",
    })
    .run();

  await db
    .insert(agentDeploymentVersionsTable)
    .values({
      agentId: PUBLIC_API_TEST_IDS.agent,
      configJson: INITIAL_AGENT_CONFIG_JSON,
      createdAt: nowMs,
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      environmentId: PUBLIC_API_TEST_IDS.environment,
      id: PUBLIC_API_TEST_IDS.deployment,
      kind: "pet",
      mcpBindingsJson: "[]",
      model: "gpt-5.4",
      prompt: "Help.",
      provider: "openai",
      runtimeId: "openai-runtime",
      skillsJson: "[]",
      summary: "Live test version",
      versionNumber: 1,
    })
    .run();

  await insertPat({
    accountId: PUBLIC_API_TEST_IDS.ownerAccount,
    database,
    id: PUBLIC_API_TEST_IDS.patOwner,
    tokenValue: TOKENS.owner,
  });
  await insertPat({
    accountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    database,
    id: PUBLIC_API_TEST_IDS.patNonOwner,
    tokenValue: TOKENS.nonOwner,
  });
  await insertPat({
    accountId: PUBLIC_API_TEST_IDS.legacyGrantAccount,
    database,
    id: PUBLIC_API_TEST_IDS.patLegacyGrant,
    tokenValue: TOKENS.legacyGrant,
  });
  await insertPat({
    accountId: PUBLIC_API_TEST_IDS.disabledAccount,
    database,
    id: PUBLIC_API_TEST_IDS.patDisabled,
    tokenValue: TOKENS.disabled,
  });
  await insertPat({
    accountId: PUBLIC_API_TEST_IDS.outsiderAccount,
    database,
    id: PUBLIC_API_TEST_IDS.patOutsider,
    tokenValue: TOKENS.outsider,
  });
  await insertPat({
    accountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    database,
    id: PUBLIC_API_TEST_IDS.patRevoked,
    revokedAt: nowMs,
    tokenValue: TOKENS.revoked,
  });

  return database;
}

const publicHttpContractDatabaseTemplate = (async () => {
  const database = new SqliteD1Database();
  applyDrizzleMigrations(database);
  await seedPublicHttpContractDatabase(database);
  return database.serialize();
})();

export async function createPublicHttpContractDatabase(): Promise<SqliteD1Database> {
  return new SqliteD1Database({ serialized: await publicHttpContractDatabaseTemplate });
}

export async function createPre0015PublicHttpContractDatabase(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsThrough(database, "0014_durable-mcp-effect-v3");
  return seedPublicHttpContractDatabase(database);
}

export async function insertActiveSandboxSessionFixture(
  database: SqliteD1Database,
  input: {
    agentId?: string;
    projectId?: string;
    cwd?: string;
    inactiveDeadlineAt?: number | null;
    kind?: "cattle" | "pet";
    ownerAccountId: string;
    sandboxId: string;
    sandboxSessionId?: string;
    sessionId: string;
    timestampMs?: number;
  },
): Promise<void> {
  const agentId = parsePlatformId<AgentId>(
    input.agentId ?? PUBLIC_API_TEST_IDS.agent,
    "fixture agent id",
  );
  const projectId = parsePlatformId<ProjectId>(
    input.projectId ?? PUBLIC_API_TEST_IDS.project,
    "fixture project id",
  );
  const ownerAccountId = parsePlatformId<AccountId>(input.ownerAccountId, "fixture account id");
  const sandboxId = parsePlatformId<SandboxId>(input.sandboxId, "fixture sandbox id");
  const sandboxSessionId = parsePlatformId<SandboxSessionId>(
    input.sandboxSessionId ?? input.sandboxId,
    "fixture sandbox session id",
  );
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "fixture session id");
  const kind = input.kind ?? "pet";
  const timestampMs = input.timestampMs ?? nowMsForTest();

  await database
    .app()
    .insert(sandboxesTable)
    .values({
      agentId,
      projectId,
      createdAt: timestampMs,
      id: sandboxId,
      inactiveDeadlineAt: input.inactiveDeadlineAt ?? null,
      incarnation: 1,
      kind,
      networkConstraintsHash: "0".repeat(64),
      ownerAccountId,
      status: "active",
      subjectId: kind === "pet" ? agentId : sessionId,
      subjectKind: kind === "pet" ? "agent" : "session",
      updatedAt: timestampMs,
    })
    .run();
  await database
    .app()
    .insert(sandboxSessionsTable)
    .values({
      createdAt: timestampMs,
      cwd: input.cwd ?? `/workspace/se/${sessionId}`,
      originJson: JSON.stringify({
        callerUserId: ownerAccountId,
        entrypoint: "api",
        executionOwnerUserId: ownerAccountId,
        type: "agent",
      }),
      sandboxId,
      sandboxIncarnation: 1,
      sandboxSessionId,
      sessionId,
      status: "active",
      updatedAt: timestampMs,
    })
    .run();
}

export async function insertNonOwnerSession(database: SqliteD1Database): Promise<void> {
  await insertSession(database, {
    creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    id: PUBLIC_API_TEST_IDS.nonOwnerSession,
    title: "Non-owner route session",
  });
}

export async function insertOwnerSession(database: SqliteD1Database): Promise<void> {
  await insertSession(database, {
    creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    id: PUBLIC_API_TEST_IDS.ownerSession,
    title: "Owner route session",
  });
}

async function insertPat(input: {
  accountId: string;
  database: SqliteD1Database;
  id: string;
  revokedAt?: number | null;
  tokenValue: string;
}): Promise<void> {
  const nowMs = nowMsForTest();
  await input.database
    .app()
    .insert(personalAccessTokensTable)
    .values({
      accountId: input.accountId,
      createdAt: new Date(nowMs),
      id: input.id,
      label: input.id,
      lastUsedAt: null,
      revokedAt:
        input.revokedAt === undefined || input.revokedAt === null
          ? null
          : new Date(input.revokedAt),
      tokenHash: await hashTokenValue(input.tokenValue),
      updatedAt: new Date(nowMs),
    })
    .run();
}

async function insertSession(
  database: SqliteD1Database,
  input: {
    creatorAccountId: string;
    id: string;
    title: string;
  },
): Promise<void> {
  await database
    .app()
    .insert(sessionsTable)
    .values({
      agentId: PUBLIC_API_TEST_IDS.agent,
      archivedAt: null,
      createdAt: nowMsForTest(),
      creatorAccountId: input.creatorAccountId,
      participantAccountId: null,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      id: input.id,
      kind: "pet",
      lastMessageAt: null,
      lastRunId: null,
      model: "gpt-5.4",
      projectId: PUBLIC_API_TEST_IDS.project,
      provider: "openai",
      renamed: false,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: input.title,
      type: "ui",
      updatedAt: nowMsForTest(),
    })
    .run();

  await database
    .app()
    .insert(sessionExecutionSnapshotsTable)
    .values({
      createdAt: nowMsForTest(),
      planJson: JSON.stringify({
        binding: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
          deploymentVersionNumber: 1,
          kind: "pet",
          model: "gpt-5.4",
          prompt: "Help.",
          provider: "openai",
          runtimeId: "openai-runtime",
        },
        environment: {
          allowMcpServers: true,
          allowPackageManagers: true,
          allowedHostsJson: "[]",
          envVarsJson: "[]",
          environmentId: PUBLIC_API_TEST_IDS.environment,
          environmentName: "Default",
          networkPolicy: "full",
          packagesJson: "[]",
          revisionId: PUBLIC_API_TEST_IDS.environmentRevision,
          setupScript: "",
        },
        skills: [],
        tools: [],
      }),
      sessionId: input.id,
    })
    .run();
}

function unavailableBinding<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${name} is not used by this public HTTP contract test.`);
      },
    },
  ) as T;
}

function createOkDurableObjectNamespace() {
  return {
    get: () => ({
      closeViewers: async () => {},
      destroy: async () => {},
      fetch: async () => new Response(null, { status: 204 }),
      publishEvents: async () => {},
      syncViewers: async () => {},
    }),
    idFromName: (name: string) => name,
  };
}
