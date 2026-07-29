import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import type { McpServerId, SkillSnapshotId, VendorCredentialId } from "@mosoo/id";

const RUNTIME_DRIVER_ROUTE_PREFIX = `${PUBLIC_API_PREFIX}/driver`;

export function getRuntimeDriverRoutePrefix(): string {
  return RUNTIME_DRIVER_ROUTE_PREFIX;
}

export function getRuntimeDriverLlmProxyPath(credentialId: VendorCredentialId): string {
  return `${RUNTIME_DRIVER_ROUTE_PREFIX}/llm/proxy/${encodeURIComponent(credentialId)}`;
}

export function getRuntimeDriverSkillPackagePath(snapshotId: SkillSnapshotId): string {
  return `${RUNTIME_DRIVER_ROUTE_PREFIX}/skill/${encodeURIComponent(snapshotId)}/package`;
}

export function getRuntimeDriverMcpProxyPath(serverId: McpServerId): string {
  return `${RUNTIME_DRIVER_ROUTE_PREFIX}/mcp/proxy/${encodeURIComponent(serverId)}`;
}

export function getRuntimeDriverSocketPath(): string {
  return `${RUNTIME_DRIVER_ROUTE_PREFIX}/socket`;
}
