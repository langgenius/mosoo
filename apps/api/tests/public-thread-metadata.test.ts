import { describe, expect, test } from "bun:test";

import type { AccountId, PersonalAccessTokenId, PlatformId } from "@mosoo/id";

import {
  createPublicApiThreadMetadata,
  parsePublicApiThreadMetadata,
} from "../src/modules/public-api/public-thread-metadata";

describe("Public Thread application-user metadata", () => {
  test("round-trips an opaque user id without treating it as a Mosoo account", () => {
    const metadata = createPublicApiThreadMetadata({
      admission: {
        createdById: "01J00000000000000000000001" as PlatformId,
        tokenId: "01J00000000000000000000061" as PersonalAccessTokenId,
        tokenLabel: "production",
      },
      idempotencyKey: "idem-1",
      userId: "customer-123",
    });

    expect(metadata.user_id).toBe("customer-123");
    expect(parsePublicApiThreadMetadata(JSON.stringify({ public_api: metadata }))).toMatchObject({
      created_by: { account_id: "01J00000000000000000000001" as AccountId },
      user_id: "customer-123",
    });
  });

  test("reads the temporary external user field from existing Thread metadata", () => {
    const metadata = createPublicApiThreadMetadata({
      admission: {
        createdById: "01J00000000000000000000001" as PlatformId,
        tokenId: "01J00000000000000000000061" as PersonalAccessTokenId,
        tokenLabel: "production",
      },
      idempotencyKey: null,
      userId: null,
    });
    const legacy = { ...metadata, external_user_id: "customer-legacy", user_id: undefined };

    expect(parsePublicApiThreadMetadata(JSON.stringify({ public_api: legacy }))).toMatchObject({
      user_id: "customer-legacy",
    });
  });
});
