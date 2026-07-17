import type { McpServerWithCredential as PoolServer } from "@mosoo/contracts/mcp";

export function createPoolServerById(servers: readonly PoolServer[]): Map<string, PoolServer> {
  const poolServerById = new Map<string, PoolServer>();

  for (const server of servers) {
    if (!poolServerById.has(server.id)) {
      poolServerById.set(server.id, server);
    }
  }

  return poolServerById;
}
