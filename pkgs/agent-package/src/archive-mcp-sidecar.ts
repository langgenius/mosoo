import type { AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";

import { readArchiveJson } from "./archive-bytes";
import { MCP_JSON_PATH } from "./archive-constants";
import { createArchiveIssue } from "./archive-issue";
import { admitMcpSidecarServer, findForbiddenMcpSecretFieldPath } from "./archive-mcp-admission";

const MCP_MANIFEST_CATALOG_FIELDS = new Set(["enabled", "name", "ref"]);

export function mergeMcpSidecarJson(
  manifestJson: string,
  entries: Record<string, Uint8Array>,
): string {
  const parsedManifest: unknown = JSON.parse(manifestJson);

  if (!isRecord(parsedManifest)) {
    throw new Error("Package manifest must be a JSON object.");
  }

  const manifest = { ...parsedManifest };
  const mcpJson = readArchiveJson(entries, MCP_JSON_PATH);

  if (isRecord(mcpJson)) {
    manifest["mcpServers"] = mergeMcpServerSidecar(manifest["mcpServers"], mcpJson);
  }

  return JSON.stringify(manifest);
}

export function collectMcpSidecarIssues(
  manifestJson: string,
  entries: Record<string, Uint8Array>,
): AgentResolutionIssue[] {
  const manifest: unknown = JSON.parse(manifestJson);

  if (!isRecord(manifest) || !Array.isArray(manifest["mcpServers"])) {
    return [];
  }

  const mcpJson = readArchiveJson(entries, MCP_JSON_PATH);
  const sidecarServers =
    isRecord(mcpJson) && isRecord(mcpJson["mcpServers"]) ? mcpJson["mcpServers"] : null;
  const issues: AgentResolutionIssue[] = [];
  const referencedServerNames = new Set<string>();

  for (const server of manifest["mcpServers"]) {
    if (!isRecord(server)) {
      continue;
    }

    issues.push(...collectMcpManifestCatalogEntryIssues(server));

    const name = typeof server["name"] === "string" ? server["name"] : null;
    const ref = typeof server["ref"] === "string" ? server["ref"] : null;

    if (ref === null || !ref.startsWith(`${MCP_JSON_PATH}#`)) {
      continue;
    }

    const targetLabel = name ?? ref.slice(`${MCP_JSON_PATH}#`.length);
    referencedServerNames.add(targetLabel);

    if (sidecarServers === null) {
      issues.push(
        createArchiveIssue({
          code: "package.mcp.missing",
          message: `Package MCP sidecar ${MCP_JSON_PATH} is missing or does not declare mcpServers.`,
          status: "missing",
          targetLabel,
          targetType: "mcp_server",
        }),
      );
      continue;
    }

    const sidecarServer = sidecarServers[targetLabel];

    if (!isRecord(sidecarServer)) {
      issues.push(
        createArchiveIssue({
          code: "package.mcp.missing",
          message: `Package MCP server ${targetLabel} is missing from ${MCP_JSON_PATH}.`,
          status: "missing",
          targetLabel,
          targetType: "mcp_server",
        }),
      );
      continue;
    }

    const forbiddenPath = findForbiddenMcpSecretFieldPath(sidecarServer);

    if (forbiddenPath !== null) {
      issues.push(
        createArchiveIssue({
          code: "package.mcp.secret_forbidden",
          message: `Package MCP server ${targetLabel} must not include secret field ${forbiddenPath}.`,
          status: "unsupported",
          targetLabel,
          targetType: "mcp_server",
        }),
      );
      continue;
    }

    const admittedServer = admitMcpSidecarServer(targetLabel, sidecarServer);

    if (!admittedServer.ok) {
      issues.push(admittedServer.issue);
    }
  }

  if (sidecarServers !== null) {
    for (const serverName of Object.keys(sidecarServers)) {
      if (!referencedServerNames.has(serverName)) {
        issues.push(
          createArchiveIssue({
            code: "package.mcp.undeclared",
            message: `Package MCP server ${serverName} is not declared by manifest.json.`,
            status: "unsupported",
            targetLabel: serverName,
            targetType: "mcp_server",
          }),
        );
        continue;
      }
    }
  }

  return issues;
}

function mergeMcpServerSidecar(
  manifestServers: unknown,
  mcpJson: Record<string, unknown>,
): unknown {
  if (!Array.isArray(manifestServers)) {
    return manifestServers;
  }

  const sidecarServers = isRecord(mcpJson["mcpServers"]) ? mcpJson["mcpServers"] : {};

  return manifestServers.map((manifestServer) => {
    if (!isRecord(manifestServer)) {
      return manifestServer;
    }

    const name = typeof manifestServer["name"] === "string" ? manifestServer["name"] : null;

    if (name === null) {
      return manifestServer;
    }

    const sidecarServer = sidecarServers[name];

    if (!isRecord(sidecarServer)) {
      return manifestServer;
    }

    const admittedServer = admitMcpSidecarServer(name, sidecarServer);

    if (!admittedServer.ok) {
      return manifestServer;
    }

    return {
      ...admittedServer.normalizedServer,
      ...manifestServer,
    };
  });
}

function collectMcpManifestCatalogEntryIssues(
  entry: Record<string, unknown>,
): AgentResolutionIssue[] {
  const issues: AgentResolutionIssue[] = [];
  const name = typeof entry["name"] === "string" ? entry["name"] : null;
  const ref = typeof entry["ref"] === "string" ? entry["ref"] : null;
  const refPrefix = `${MCP_JSON_PATH}#`;

  for (const field of Object.keys(entry)) {
    if (MCP_MANIFEST_CATALOG_FIELDS.has(field)) {
      continue;
    }

    issues.push(
      createArchiveIssue({
        code: "package.mcp.field.unsupported",
        message: `MCP server catalog field ${field} is not supported in manifest.json.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
    );
  }

  if (name === null || name.trim().length === 0) {
    issues.push(
      createArchiveIssue({
        code: "package.mcp.name.missing",
        message: "MCP server package declaration must include a name.",
        status: "unsupported",
        targetLabel: null,
        targetType: "mcp_server",
      }),
    );
  }

  if (ref === null || !ref.startsWith(refPrefix)) {
    issues.push(
      createArchiveIssue({
        code: "package.mcp.ref.missing",
        message: `MCP server ${name ?? "(unknown)"} must reference .mcp.json instead of inline connection fields.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
    );
    return issues;
  }

  const refName = ref.slice(refPrefix.length);

  if (name !== null && refName !== name) {
    issues.push(
      createArchiveIssue({
        code: "package.mcp.ref.mismatch",
        message: `MCP server ${name} must use ref .mcp.json#${name}.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
    );
  }

  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
