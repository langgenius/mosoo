import { describe, expect, test } from "bun:test";

import type { AppDeploymentId, AppDeploymentRunId, PersonalAccessTokenId } from "@mosoo/id";

import {
  createPublicApiThreadMetadata,
  isDeploymentCapabilityCreatedBy,
  parsePublicApiThreadMetadata,
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

    expect(parsePublicApiThreadMetadata(JSON.stringify({ public_api: metadata }))).toEqual(
      metadata,
    );
    expect(isDeploymentCapabilityCreatedBy(metadata.created_by)).toBe(false);
  });

  test("round-trips deployment capability audit metadata", () => {
    const metadata = createPublicApiThreadMetadata({
      createdBy: {
        binding_env: "MOSOO_AGENT_URL",
        binding_name: "Codex Pet",
        deployment_id: "01J0000000000000000000000D" as AppDeploymentId,
        deployment_run_id: "01J0000000000000000000000R" as AppDeploymentRunId,
        kind: "deployment_capability",
      },
      idempotencyKey: null,
    });

    expect(parsePublicApiThreadMetadata(JSON.stringify({ public_api: metadata }))).toEqual(
      metadata,
    );
    expect(isDeploymentCapabilityCreatedBy(metadata.created_by)).toBe(true);
  });

  test("rejects deployment capability metadata with unknown or malformed fields", () => {
    const base = {
      binding_env: "MOSOO_AGENT_URL",
      binding_name: "Codex Pet",
      deployment_id: "01J0000000000000000000000D",
      deployment_run_id: "01J0000000000000000000000R",
      kind: "deployment_capability",
    };

    for (const createdBy of [
      { ...base, token_id: "01J00000000000000000000061" },
      { ...base, deployment_id: "not-a-ulid" },
      { ...base, binding_env: "" },
      { kind: "deployment_capability" },
    ]) {
      expect(
        parsePublicApiThreadMetadata(
          JSON.stringify({
            public_api: { created_by: createdBy, idempotency_key: null, source: "public_api" },
          }),
        ),
      ).toBeNull();
    }
  });
});
