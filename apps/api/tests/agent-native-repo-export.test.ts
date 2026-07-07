import { describe, expect, test } from "bun:test";

import {
  collectPackageIssues,
  hasBlockingPackageIssue,
} from "@mosoo/contracts/agent-manifest-parser";
import { MOSOO_NATIVE_SPEC } from "@mosoo/contracts/native-deployment";
import {
  agentMcpBindingsTable,
  agentSkillsTable,
  agentsTable,
  environmentRevisionsTable,
  mcpServersTable,
  skillsTable,
} from "@mosoo/db";
import type { AgentMcpBindingId, AppId, McpServerId, SkillId } from "@mosoo/id";
import { createZipArchive } from "@mosoo/skill-package";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";

import { exportAgentNativeRepo } from "../src/modules/agents/application/agent-native-repo-export.service";
import { validateNativeDeployment } from "../src/modules/apps/application/native-deployment-validator";
import { publishSkillSnapshot } from "../src/modules/skills/application/skill-package-snapshot.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  nowMsForTest,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";
import { OWNER_VIEWER } from "./public-thread-api-fixtures";

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  etag: string;
  key: string;
}

const APP_ID = PUBLIC_API_TEST_IDS.app as AppId;
const AGENT_ID = PUBLIC_API_TEST_IDS.agent;
const ENVIRONMENT_SECRET_VALUE = "source-secret-value";
const ENVIRONMENT_SECRET_ID = "environment-secret-id";
const MCP_SERVER_ID = "01J000000000000000000000E1" as McpServerId;
const AGENT_MCP_BINDING_ID = "01J000000000000000000000E2" as AgentMcpBindingId;
const SKILL_ID = "01J000000000000000000000E3" as SkillId;
const NATIVE_MARKER_TOML = `spec = "${MOSOO_NATIVE_SPEC}"\n`;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

class MemoryByteBucket {
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
    const ifNoneMatch =
      options?.onlyIf instanceof Headers ? options.onlyIf.get("If-None-Match") : null;

    if (ifNoneMatch === "*" && existing !== undefined) {
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
  ): Promise<Uint8Array> {
    if (body === null) {
      return new Uint8Array();
    }

    if (typeof body === "string") {
      return textEncoder.encode(body);
    }

    if (body instanceof Blob) {
      return new Uint8Array(await body.arrayBuffer());
    }

    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }

    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
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

  #toObject(stored: StoredObject): R2Object {
    return {
      customMetadata: {},
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
    const bytes = new Uint8Array(stored.body);

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
        return JSON.parse(textDecoder.decode(bytes)) as T;
      },
      async text() {
        return textDecoder.decode(bytes);
      },
    } as R2ObjectBody;
  }
}

function encode(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSkillArchive(): Uint8Array {
  return createZipArchive([
    {
      body: encode(
        "---\nname: Export Helper\ndescription: Skill carried by native repo export\n---\n# Export Helper\n",
      ),
      entryKind: "file",
      isExecutable: false,
      path: "export-helper/SKILL.md",
    },
    {
      body: encode("Use this support note during export validation.\n"),
      entryKind: "file",
      isExecutable: false,
      path: "export-helper/references/tip.txt",
    },
  ]);
}

async function createExportFixture(agentStatus: "draft" | "published"): Promise<{
  bindings: ApiBindings;
  bucket: MemoryByteBucket;
  database: SqliteD1Database;
}> {
  const database = await createPublicHttpContractDatabase();

  database.execute(`
    CREATE TABLE IF NOT EXISTS skill_snapshot (
      id text PRIMARY KEY NOT NULL,
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    CREATE UNIQUE INDEX IF NOT EXISTS skill_snapshot_blob_sha256_idx
      ON skill_snapshot (app_id, blob_sha256);

    CREATE TABLE IF NOT EXISTS skill_snapshot_entry (
      entry_kind text NOT NULL,
      is_executable integer NOT NULL,
      mime_type text,
      path text NOT NULL,
      sha256 text,
      size integer NOT NULL,
      snapshot_id text NOT NULL,
      PRIMARY KEY (snapshot_id, path)
    );
  `);

  const bucket = new MemoryByteBucket();
  const bindings = createPublicHttpTestBindings(database, {
    fileBucket: bucket as unknown as R2Bucket,
  }) as ApiBindings;
  const db = database.app();
  const nowMs = nowMsForTest();
  const skillSnapshot = await publishSkillSnapshot(
    bindings,
    { appId: APP_ID },
    {
      file: {
        bytes: createSkillArchive(),
        name: "export-helper.skill",
      },
    },
  );

  await db
    .update(agentsTable)
    .set({
      description: "Exportable native repo fixture.",
      liveDeploymentVersionId: agentStatus === "published" ? PUBLIC_API_TEST_IDS.deployment : null,
      name: "quiz-master",
      status: agentStatus,
      updatedAt: nowMs,
    })
    .where(eq(agentsTable.id, AGENT_ID))
    .run();

  await db
    .update(environmentRevisionsTable)
    .set({
      envVarsJson: JSON.stringify([
        {
          key: "NATIVE_SECRET",
          preview: ENVIRONMENT_SECRET_VALUE,
          secretId: ENVIRONMENT_SECRET_ID,
        },
      ]),
      setupScript: "bun install",
    })
    .where(eq(environmentRevisionsTable.id, PUBLIC_API_TEST_IDS.environmentRevision))
    .run();

  await db
    .insert(skillsTable)
    .values({
      author: "Owner",
      createdAt: nowMs,
      currentSnapshotId: skillSnapshot.snapshot.id,
      description: "Skill carried by native repo export",
      forkedFromOwnerName: null,
      forkedFromSkillId: null,
      forkedFromSkillName: null,
      id: SKILL_ID,
      name: "Export Helper",
      ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      appId: APP_ID,
      sourceKind: "upload",
      updatedAt: nowMs,
      version: "1.0.0",
    })
    .run();

  await db
    .insert(agentSkillsTable)
    .values({
      agentId: AGENT_ID,
      createdAt: nowMs,
      skillId: SKILL_ID,
      sortOrder: 0,
    })
    .run();

  await db
    .insert(mcpServersTable)
    .values({
      authType: "bearer",
      byoClientId: null,
      byoClientSecretSecretId: null,
      createdAt: nowMs,
      credentialScope: "app",
      description: "GitHub MCP fixture",
      enabled: true,
      iconUrl: null,
      id: MCP_SERVER_ID,
      name: "github",
      oauthMetadataJson: null,
      ownerId: PUBLIC_API_TEST_IDS.ownerAccount,
      appId: APP_ID,
      source: "app",
      updatedAt: nowMs,
      url: "https://mcp.github.example/mcp",
    })
    .run();

  await db
    .insert(agentMcpBindingsTable)
    .values({
      agentCredentialId: null,
      agentId: AGENT_ID,
      createdAt: nowMs,
      credentialMode: "runtime_resolved",
      enabled: true,
      id: AGENT_MCP_BINDING_ID,
      serverId: MCP_SERVER_ID,
      sortOrder: 0,
      updatedAt: nowMs,
    })
    .run();

  return { bindings, bucket, database };
}

async function readFileObjectKey(database: SqliteD1Database, fileId: string): Promise<string> {
  const row = await database
    .prepare("SELECT object_key FROM file_record WHERE id = ?")
    .bind(fileId)
    .first<{ object_key: string }>();

  if (row === null) {
    throw new Error("Expected exported file row.");
  }

  return row.object_key;
}

async function readExportArchiveBytes(input: {
  bucket: MemoryByteBucket;
  database: SqliteD1Database;
  fileId: string;
}): Promise<Uint8Array> {
  const objectKey = await readFileObjectKey(input.database, input.fileId);
  const object = await input.bucket.get(objectKey);

  if (object === null) {
    throw new Error("Expected exported archive object.");
  }

  return new Uint8Array(await object.arrayBuffer());
}

function unzipTextFiles(archiveBytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(archiveBytes)).map(([path, bytes]) => [
      path,
      textDecoder.decode(bytes),
    ]),
  );
}

/**
 * Every string value carried by an archive entry: JSON entries are walked
 * recursively (keys and values) so a secret nested anywhere is seen; non-JSON
 * entries scan as their raw text. Lets the export test assert no seeded secret
 * survives blanking, rather than checking one known literal is absent.
 */
function collectEntryStringValues(content: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return [content];
  }

  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }

    if (isRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        strings.push(key);
        walk(entry);
      }
    }
  };

  walk(parsed);

  return strings;
}

describe("agent native repo export", () => {
  for (const agentStatus of ["draft", "published"] as const) {
    test(`exports a ${agentStatus} agent as a validating native deployable repo`, async () => {
      const fixture = await createExportFixture(agentStatus);
      const exported = await exportAgentNativeRepo(fixture.bindings, OWNER_VIEWER, {
        agentId: AGENT_ID,
      });
      const archiveBytes = await readExportArchiveBytes({
        bucket: fixture.bucket,
        database: fixture.database,
        fileId: exported.fileId,
      });
      const files = unzipTextFiles(archiveBytes);
      const manifestValue: unknown = JSON.parse(files[".agent/manifest.json"] ?? "null");
      const packageIssues = isRecord(manifestValue) ? collectPackageIssues(manifestValue) : [];
      const validate = validateNativeDeployment({ files });

      expect(exported.fileName).toBe("quiz-master-native.zip");
      expect(files[".mosoo.toml"]).toBe(NATIVE_MARKER_TOML);
      expect(files[".agent/.mcp.json"]).toContain("https://mcp.github.example/mcp");
      expect(files[".agent/environment/definition.json"]).toContain("NATIVE_SECRET");
      expect(files[".agent/skills/export-helper/SKILL.md"]).toContain("Export Helper");
      expect(files[".agent/skills/export-helper/references/tip.txt"]).toContain("support note");
      expect(isRecord(manifestValue)).toBe(true);
      expect(hasBlockingPackageIssue(packageIssues)).toBe(false);
      expect(validate.valid).toBe(true);
      expect(validate.failures.filter((failure) => failure.severity === "error")).toEqual([]);

      // Scan every string value in every archive entry for each seeded secret
      // (the env preview value and its internal secretId — the only credential
      // material in this fixture), so a regression that leaks a truncated
      // preview, the secretId, or an MCP credential under a different key is
      // caught, not just the one known literal.
      const seededSecrets = [ENVIRONMENT_SECRET_VALUE, ENVIRONMENT_SECRET_ID];

      for (const [path, content] of Object.entries(files)) {
        for (const value of collectEntryStringValues(content)) {
          for (const secret of seededSecrets) {
            expect(value.includes(secret), `${path} leaked seeded secret ${secret}`).toBe(false);
          }
        }
      }
    });
  }
});
