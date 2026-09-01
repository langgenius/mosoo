import { describe, expect, test } from "bun:test";

import type { PersonalAccessTokenId } from "@mosoo/id";

import {
  createPublicApiThreadMetadata,
  parsePublicApiThreadRecordMetadata,
} from "../src/modules/public-api/public-thread-metadata";

describe("Public Thread metadata", () => {
  test("round-trips the canonical access-token audit metadata", () => {
    const metadata = createPublicApiThreadMetadata({
      createdBy: {
        token_id: "01J00000000000000000000061" as PersonalAccessTokenId,
        token_label: "production",
      },
      idempotencyKey: "idem-1",
    });

    expect(parsePublicApiThreadRecordMetadata(JSON.stringify({ public_api: metadata }))).toEqual({
      idempotency_key: "idem-1",
      source: "public_api",
    });
  });

  test("keeps stored Public Threads readable without interpreting creator history", () => {
    expect(
      parsePublicApiThreadRecordMetadata(
        JSON.stringify({
          public_api: {
            created_by: { historical_caller: "retired" },
            idempotency_key: null,
            source: "public_api",
          },
        }),
      ),
    ).toEqual({ idempotency_key: null, source: "public_api" });
  });

  test("rejects malformed Public Thread envelopes", () => {
    for (const publicApi of [
      { created_by: null, idempotency_key: null, source: "public_api" },
      { created_by: {}, idempotency_key: 1, source: "public_api" },
      { created_by: {}, idempotency_key: null, source: "other" },
      { created_by: {}, idempotency_key: null, source: "public_api", unknown: true },
    ]) {
      expect(
        parsePublicApiThreadRecordMetadata(JSON.stringify({ public_api: publicApi })),
      ).toBeNull();
    }
  });
});
