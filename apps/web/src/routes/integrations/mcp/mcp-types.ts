import type {
  McpAuthType,
  McpCredentialSummary as McpCredential,
  McpCredentialScope,
  McpCredentialStatus,
  McpRegistry,
  McpServer,
  McpServerSource,
  McpServerWithCredential,
} from "@mosoo/contracts/mcp";

export type {
  McpAuthType,
  McpCredential,
  McpCredentialScope,
  McpCredentialStatus,
  McpRegistry,
  McpServer,
  McpServerSource,
  McpServerWithCredential,
};

export type McpViewMode = "personal" | "shared" | "managed";
