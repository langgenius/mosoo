import type { McpAuthType, McpCredentialScope, McpCredentialStatus } from "./mcp-types";

export function authTypeLabel(t: McpAuthType): string {
  switch (t) {
    case "oauth": {
      return "OAuth";
    }
    case "bearer": {
      return "Bearer Token";
    }
    default: {
      return unreachableCase(t, "Unsupported MCP auth type.");
    }
  }
}

export function credentialScopeLabel(scope: McpCredentialScope): string {
  switch (scope) {
    case "app": {
      return "App credential";
    }
    default: {
      return unreachableCase(scope, "Unsupported MCP credential scope.");
    }
  }
}

export function statusText(s: McpCredentialStatus): string {
  switch (s) {
    case "active": {
      return "Authorized";
    }
    case "expired": {
      return "Expired";
    }
    case "revoked": {
      return "Revoked";
    }
    case "none": {
      return "Needs authorization";
    }
    default: {
      return unreachableCase(s, "Unsupported MCP credential status.");
    }
  }
}

function unreachableCase(_value: never, message: string): never {
  throw new Error(message);
}
