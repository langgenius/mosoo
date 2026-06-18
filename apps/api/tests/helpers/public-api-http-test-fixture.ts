import { readFileSync } from "node:fs";

import type { SessionSummary } from "@mosoo/contracts/session";
import {
  accountsTable,
  agentDeploymentVersionsTable,
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  organizationsTable,
  personalAccessTokensTable,
  appsTable,
  sessionsTable,
  vendorCredentialsTable,
} from "@mosoo/db";
import type { VendorCredentialId } from "@mosoo/id";

import { hashTokenValue } from "../../src/modules/auth/application/personal-access-token.service";
import { storeVendorCredentialSecret } from "../../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../../src/platform/cloudflare/worker-types";
import type { ApiCommandQueueStub } from "./channel-final-delivery-queue-fixture";
import type { ChannelFinalDeliveryQueueStub } from "./channel-final-delivery-queue-fixture";
import { createApiCommandQueueStub } from "./channel-final-delivery-queue-fixture";
import { createChannelFinalDeliveryQueueStub } from "./channel-final-delivery-queue-fixture";
import { SqliteD1Database } from "./sqlite-d1";
export { SqliteD1Database } from "./sqlite-d1";
export {
  createApiCommandQueueStub,
  createChannelFinalDeliveryQueueStub,
  createRecordedQueueMessage,
  type ApiCommandQueueStub,
  type CapturedApiCommandMessage,
  type CapturedChannelFinalDeliveryMessage,
  type ChannelFinalDeliveryQueueStub,
  type RecordedQueueMessage,
  type RecordedQueueMessageAction,
} from "./channel-final-delivery-queue-fixture";

const CONTRACT_SCHEMA_SQL = readFileSync(
  new URL("./public-api-http-core-schema.sql", import.meta.url),
  "utf8",
)
  .concat("\n")
  .concat(readFileSync(new URL("./public-api-http-wechat-schema.sql", import.meta.url), "utf8"));

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
  app: "01J0000000000000000000000Q",
  run: "01J0000000000000000000000N",
  runAlt: "01J0000000000000000000000P",
  sandbox: "01J0000000000000000000000D",
  driverNonOwner: "01J0000000000000000000000E",
  driverOwner: "01J0000000000000000000000F",
} as const;

const PUBLIC_API_VENDOR_CREDENTIAL_ID = "vendor-openai-app" as VendorCredentialId;

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
  body: string;
  contentType: string;
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
      body: await this.#readBody(body),
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
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
  ): Promise<string> {
    if (body === null) {
      return "";
    }

    if (typeof body === "string") {
      return body;
    }

    if (body instanceof Blob) {
      return body.text();
    }

    if (body instanceof ArrayBuffer) {
      return new TextDecoder().decode(body);
    }

    if (ArrayBuffer.isView(body)) {
      return new TextDecoder().decode(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      );
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

    return new TextDecoder().decode(bytes);
  }

  #readOnlyIfHeader(onlyIf: R2PutOptions["onlyIf"] | undefined, name: string): string | null {
    return onlyIf instanceof Headers ? onlyIf.get(name) : null;
  }

  #toObject(stored: StoredObject): R2Object {
    return {
      customMetadata: {},
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: {
        contentType: stored.contentType,
      },
      key: stored.key,
      size: new TextEncoder().encode(stored.body).byteLength,
      uploaded: new Date(0),
      version: "",
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", stored.contentType);
      },
    } as R2Object;
  }

  #toObjectBody(stored: StoredObject): R2ObjectBody {
    const bytes = new TextEncoder().encode(stored.body);

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
        return JSON.parse(stored.body) as T;
      },
      async text() {
        return stored.body;
      },
    } as R2ObjectBody;
  }
}

export function createPublicHttpTestBindings(
  database: D1Database,
  options: {
    apiCommandQueue?: ApiCommandQueueStub;
    fileBucket?: R2Bucket;
    queue?: ChannelFinalDeliveryQueueStub;
  } = {},
): Record<string, unknown> {
  return {
    APP_NAME: "mosoo",
    AUTH_EMAIL: unavailableBinding<SendEmail>("AUTH_EMAIL"),
    AUTH_EMAIL_FROM: "Mosoo AUTH <auth@mosoo.ai>",
    BETTER_AUTH_SECRET: "test-secret",
    API_COMMAND_QUEUE: options.apiCommandQueue ?? createApiCommandQueueStub(),
    CHANNEL_FINAL_DELIVERY_QUEUE: options.queue ?? createChannelFinalDeliveryQueueStub(),
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
    Session: createOkDurableObjectNamespace(),
    VAULT_ROOT_SECRET: "test-vault-secret",
    WEB_ORIGIN: "https://mosoo.ai",
  };
}

export async function createPublicHttpContractDatabase(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  const nowMs = nowMsForTest();

  database.execute(CONTRACT_SCHEMA_SQL);

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
      name: "Mosoo Test Org",
      updatedAt: nowMs,
    })
    .run();

  await db
    .insert(appsTable)
    .values({
      createdAt: nowMs,
      defaultEnvironmentId: PUBLIC_API_TEST_IDS.environment,
      id: PUBLIC_API_TEST_IDS.app,
      name: "Default App",
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
      appId: PUBLIC_API_TEST_IDS.app,
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
      appId: PUBLIC_API_TEST_IDS.app,
      updatedAt: nowMs,
    })
    .run();

  const apiKeySecretId = await storeVendorCredentialSecret(
    createPublicHttpTestBindings(database) as ApiBindings,
    {
      apiKey: "sk-test",
      credentialId: PUBLIC_API_VENDOR_CREDENTIAL_ID,
      appId: PUBLIC_API_TEST_IDS.app,
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
      name: "App OpenAI",
      appId: PUBLIC_API_TEST_IDS.app,
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
      appId: PUBLIC_API_TEST_IDS.app,
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
      attributedUserId: null,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      id: input.id,
      kind: "pet",
      lastMessageAt: null,
      lastRunId: null,
      model: "gpt-5.4",
      appId: PUBLIC_API_TEST_IDS.app,
      provider: "openai",
      renamed: false,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: input.title,
      type: "api_channel",
      updatedAt: nowMsForTest(),
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
    }),
    idFromName: (name: string) => name,
  };
}
