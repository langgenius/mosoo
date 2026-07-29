import { describe, expect, test } from "bun:test";

import { isPlatformId } from "@mosoo/id";

import {
  decodeSandboxBackupIdForPlatform,
  encodeSandboxBackupIdForStorage,
} from "../src/modules/runtime/infrastructure/sandbox-backup-id";

describe("sandbox backup id", () => {
  test("round-trips Cloudflare UUID v4 handles through the existing D1 id shape", () => {
    const cloudflareId = "550e8400-e29b-41d4-a716-446655440000";
    const storedId = encodeSandboxBackupIdForStorage(cloudflareId);

    expect(isPlatformId(storedId)).toBe(true);
    expect(storedId).toBe("7NAGX100WADHTJE5J4CSAM8000");
    expect(decodeSandboxBackupIdForPlatform(storedId)).toBe(cloudflareId);
    expect(decodeSandboxBackupIdForPlatform("01J0000000000000000000000V")).toBe(
      "01J0000000000000000000000V",
    );
  });
});
