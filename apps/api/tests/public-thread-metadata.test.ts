import { describe, expect, test } from "bun:test";

import type { PersonalAccessTokenId } from "@mosoo/id";

import {
  createPublicApiThreadMetadata,
  parsePublicApiThreadMetadata,
} from "../src/modules/public-api/public-thread-metadata";

describe("Public Thread metadata", () => {
  test("round-trips the canonical access-token audit metadata", () => {
    const metadata = createPublicApiThreadMetadata({
      admission: {
        tokenId: "01J00000000000000000000061" as PersonalAccessTokenId,
        tokenLabel: "production",
      },
      idempotencyKey: "idem-1",
    });

    expect(parsePublicApiThreadMetadata(JSON.stringify({ public_api: metadata }))).toEqual(
      metadata,
    );
  });
});
