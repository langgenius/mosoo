import { describe, expect, test } from "bun:test";

import {
  createAgentPackageArchiveBytes,
  MAX_AGENT_PACKAGE_ARCHIVE_BYTES,
} from "@mosoo/agent-package";
import type { AgentPackage } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "@mosoo/contracts/agent-manifest";
import type { AccountId, FileId, OrganizationId, AppId } from "@mosoo/id";
import { zipSync } from "fflate";

import { createAgentPackageFile } from "../src/modules/agents/application/agent-package-file.service";
import { importAgentPackage } from "../src/modules/agents/application/agent-package-import.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  etag: string;
  key: string;
}

const textEncoder = new TextEncoder();
const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount as AccountId,
  imageUrl: null,
  name: "Owner",
};
const ORGANIZATION_ID = PUBLIC_API_TEST_IDS.organization as OrganizationId;
const APP_ID = PUBLIC_API_TEST_IDS.app as AppId;

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
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      },
      async text() {
        return new TextDecoder().decode(bytes);
      },
    } as R2ObjectBody;
  }
}

function createPackageFixture(): AgentPackage {
  return {
    app: {
      avatarAssetKey: null,
      description: "Imported from a file",
      name: "Imported Package Agent",
    },
    assets: [],
    author: null,
    exportedAt: "2026-01-01T00:00:00.000Z",
    license: null,
    manifest: {
      advanced: null,
      environment: {
        environmentId: null,
        envVars: {},
        expectedName: null,
        setupScript: "",
      },
      kind: "pet",
      manifestVersion: AGENT_MANIFEST_VERSION,
      mcpServers: [],
      metadata: {
        description: "Imported from a file",
        name: "Imported Package Agent",
      },
      prompts: {
        system: "Help with imported work.",
      },
      runtime: {
        id: "openai-runtime",
        model: "gpt-5.4",
        provider: "openai",
        providerOptions: {},
      },
      skills: [],
      spaces: [],
    },
    packageVersion: AGENT_PACKAGE_VERSION,
    sourceAgentId: null,
    version: "1.0.0",
  };
}

async function createFixture(input: { archiveBytes?: Uint8Array } = {}) {
  const database = await createPublicHttpContractDatabase();
  database.execute(`
    CREATE TABLE IF NOT EXISTS skill (
      author text NOT NULL,
      created_at integer NOT NULL,
      current_snapshot_id text NOT NULL,
      description text NOT NULL,
      forked_from_owner_name text,
      forked_from_skill_id text,
      forked_from_skill_name text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL,
      version text
    );

    CREATE TABLE IF NOT EXISTS agent_skill (
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      skill_id text NOT NULL,
      sort_order integer NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );
  `);
  const bucket = new MemoryByteBucket();
  const bindings = createPublicHttpTestBindings(database, {
    fileBucket: bucket as unknown as R2Bucket,
  }) as ApiBindings;
  const archiveBytes =
    input.archiveBytes ?? createAgentPackageArchiveBytes(createPackageFixture(input));
  const file = await createAgentPackageFile({
    archiveBytes,
    bindings,
    fileName: "portable.agent",
    appId: APP_ID,
    viewer: OWNER_VIEWER,
  });
  const row = await readFileRow(database, file.fileId);

  if (row === null) {
    throw new Error("Expected package file row.");
  }

  return {
    bindings,
    bucket,
    database,
    fileId: file.fileId,
    objectKey: row.object_key,
  };
}

async function readFileRow(database: SqliteD1Database, fileId: FileId) {
  return database
    .prepare(
      `
        SELECT id, object_key, purpose, scope_kind, status
          FROM file_record
         WHERE id = ?
      `,
    )
    .bind(fileId)
    .first<{
      id: FileId;
      object_key: string;
      purpose: string;
      scope_kind: string;
      status: string;
    }>();
}

async function expectImportRejected(input: {
  bindings: ApiBindings;
  fileId: FileId;
  message: string;
}): Promise<void> {
  await expect(
    importAgentPackage(input.bindings, OWNER_VIEWER, {
      fileId: input.fileId,
      appId: APP_ID,
    }),
  ).rejects.toThrow(input.message);
}

describe("agent package file import", () => {
  const admissionCases = [
    {
      message: "Agent package file purpose must be agent_package.",
      name: "rejects wrong purpose",
      updateSql: "UPDATE file_record SET purpose = 'app_draft' WHERE id = ?",
    },
    {
      message: "Agent package file is not ready.",
      name: "rejects pending files",
      updateSql: "UPDATE file_record SET status = 'pending' WHERE id = ?",
    },
    {
      message: "Agent package file is expired.",
      name: "rejects expired files",
      updateSql: "UPDATE file_record SET expires_at = 1 WHERE id = ?",
    },
    {
      message: "Agent package file does not belong to the importing user.",
      name: "rejects cross-owner files",
      updateSql: `UPDATE file_record SET created_by_account_id = '${PUBLIC_API_TEST_IDS.memberAccount}' WHERE id = ?`,
    },
    {
      message: "Agent package file does not belong to the target App.",
      name: "rejects cross-app files",
      updateSql: "UPDATE file_record SET scope_id = '01J0000000000000000000000Z' WHERE id = ?",
    },
    {
      message: "Agent package file does not belong to the target App.",
      name: "rejects legacy org-owned package files",
      updateSql: `UPDATE file_record SET owner_kind = 'organization', owner_id = '${ORGANIZATION_ID}', scope_id = '${ORGANIZATION_ID}' WHERE id = ?`,
    },
    {
      message: "Agent package file is too large.",
      name: "rejects oversized files",
      updateSql: `UPDATE file_record SET size = ${MAX_AGENT_PACKAGE_ARCHIVE_BYTES + 1} WHERE id = ?`,
    },
  ] as const;

  for (const testCase of admissionCases) {
    test(testCase.name, async () => {
      const { bindings, database, fileId } = await createFixture();

      await database.prepare(testCase.updateSql).bind(fileId).run();
      await expectImportRejected({ bindings, fileId, message: testCase.message });
    });
  }

  test("rejects bad ZIP files and keeps the package for TTL cleanup", async () => {
    const { bindings, bucket, database, fileId, objectKey } = await createFixture({
      archiveBytes: textEncoder.encode("not a zip"),
    });

    await expectImportRejected({
      bindings,
      fileId,
      message: "Agent package archive is missing a central directory.",
    });

    expect(await readFileRow(database, fileId)).not.toBeNull();
    expect(bucket.objects.has(objectKey)).toBe(true);
  });

  test("rejects bad manifests", async () => {
    const { bindings, fileId } = await createFixture({
      archiveBytes: zipSync({
        "manifest.json": textEncoder.encode("{"),
      }),
    });

    await expectImportRejected({
      bindings,
      fileId,
      message: "Agent package manifest.json and sidecar JSON files must be valid JSON.",
    });
  });

  test("imports from a ready package file and deletes the temp file", async () => {
    const { bindings, bucket, database, fileId, objectKey } = await createFixture();

    const imported = await importAgentPackage(bindings, OWNER_VIEWER, {
      fileId,
      appId: APP_ID,
    });

    expect(imported.agent.name).toBe("Imported Package Agent");
    expect(await readFileRow(database, fileId)).toBeNull();
    expect(bucket.objects.has(objectKey)).toBe(false);
  });
});
