import { describe, expect, test } from "bun:test";

import { fileRecordsTable } from "@mosoo/db";
import type { FileId } from "@mosoo/id";

import { fileStore } from "../src/modules/files/application/file-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

type PublicApiTestDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

async function insertSessionAttachment(
  database: PublicApiTestDatabase,
  input: { fileId: FileId; name: string },
): Promise<void> {
  const nowMs = nowMsForTest();
  const parentPath = `attachment/${input.fileId}`;
  const path = `${parentPath}/${input.name}`;

  await database
    .project()
    .insert(fileRecordsTable)
    .values({
      committed: 1,
      createdAt: nowMs,
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      etag: null,
      expiresAt: null,
      id: input.fileId,
      mimeType: "text/plain",
      name: input.name,
      objectKey: `session/${PUBLIC_API_TEST_IDS.ownerSession}/${path}`,
      ownerId: PUBLIC_API_TEST_IDS.ownerSession,
      ownerKind: "session",
      parentPath,
      path,
      purpose: "session_attachment",
      scopeId: PUBLIC_API_TEST_IDS.ownerSession,
      scopeKind: "session",
      sessionKind: "attachment",
      size: 10,
      status: "ready",
      updatedAt: nowMs,
      version: 1,
    })
    .run();
}

function createPrepareCounter(database: PublicApiTestDatabase): {
  database: D1Database;
  getPrepareCount(): number;
} {
  let prepareCount = 0;

  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            prepareCount += 1;
            return target.prepare(query);
          };
        }

        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    getPrepareCount: () => prepareCount,
  };
}

describe("session attachment validation", () => {
  test("validates an ordered attachment batch with a constant number of D1 statements", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertSessionAttachment(database, {
      fileId: PUBLIC_API_TEST_IDS.file,
      name: "first.txt",
    });
    await insertSessionAttachment(database, {
      fileId: PUBLIC_API_TEST_IDS.fileAlt,
      name: "second.txt",
    });
    const counter = createPrepareCounter(database);
    const bindings = createPublicHttpTestBindings(counter.database) as ApiBindings;

    const attachments = await fileStore.ensureSessionAttachments(
      bindings,
      {
        email: "owner@example.com",
        emailVerified: true,
        id: PUBLIC_API_TEST_IDS.ownerAccount,
        imageUrl: null,
        name: "Owner",
      },
      PUBLIC_API_TEST_IDS.ownerSession,
      [PUBLIC_API_TEST_IDS.fileAlt, PUBLIC_API_TEST_IDS.file, PUBLIC_API_TEST_IDS.fileAlt],
    );

    expect(attachments.map((attachment) => attachment.id)).toEqual([
      PUBLIC_API_TEST_IDS.fileAlt,
      PUBLIC_API_TEST_IDS.file,
      PUBLIC_API_TEST_IDS.fileAlt,
    ]);
    expect(counter.getPrepareCount()).toBe(2);
  });
});
