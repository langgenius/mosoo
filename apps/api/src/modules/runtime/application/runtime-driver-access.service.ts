import { parsePlatformId } from "@mosoo/id";
import type { CredentialId, DriverInstanceId, McpServerId, SkillSnapshotId } from "@mosoo/id";

import { cleanupDriverInstances } from "../infrastructure/driver-instance/maintenance";
import { requireDriverInstanceGrant } from "../infrastructure/driver-instance/mcp-grants.repository";
import type { RuntimeActionTokenPayload } from "../infrastructure/runtime-boot-token";
import { verifyRuntimeActionToken } from "../infrastructure/runtime-boot-token";

export type RuntimeDriverInstanceGrantRequest =
  | {
      credentialId: string;
      driverInstanceId: string;
      requireAction: "invalidate" | "refresh";
    }
  | {
      driverInstanceId: string;
      requireAction: "mcp_proxy";
      serverId: string;
    }
  | {
      driverInstanceId: string;
      requireAction: "skill_snapshot";
      snapshotId: string;
    };

export type { RuntimeActionTokenPayload };
export { cleanupDriverInstances, verifyRuntimeActionToken };

export async function requireRuntimeDriverInstanceGrant(
  database: D1Database,
  input: RuntimeDriverInstanceGrantRequest,
): Promise<void> {
  const driverInstanceId = parsePlatformId<DriverInstanceId>(
    input.driverInstanceId,
    "driver instance id",
  );

  if (input.requireAction === "mcp_proxy") {
    return requireDriverInstanceGrant(database, {
      driverInstanceId,
      requireAction: input.requireAction,
      serverId: parsePlatformId<McpServerId>(input.serverId, "mcp server id"),
    });
  }

  if (input.requireAction === "skill_snapshot") {
    return requireDriverInstanceGrant(database, {
      driverInstanceId,
      requireAction: input.requireAction,
      snapshotId: parsePlatformId<SkillSnapshotId>(input.snapshotId, "skill snapshot id"),
    });
  }

  return requireDriverInstanceGrant(database, {
    credentialId: parsePlatformId<CredentialId>(input.credentialId, "credential id"),
    driverInstanceId,
    requireAction: input.requireAction,
  });
}
