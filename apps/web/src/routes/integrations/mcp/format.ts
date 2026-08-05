import type { McpAuthType, McpCredentialStatus } from "./mcp-types";

type Translate = (key: string, variables?: Record<string, string>) => string;

export function authTypeLabel(t: McpAuthType, translate: Translate): string {
  switch (t) {
    case "oauth": {
      return translate("mcp.oauth");
    }
    case "bearer": {
      return translate("mcp.bearerToken");
    }
    default: {
      return unreachableCase(t, "Unsupported MCP auth type.");
    }
  }
}

export function statusText(s: McpCredentialStatus, translate: Translate): string {
  switch (s) {
    case "active": {
      return translate("mcp.statusAuthorized");
    }
    case "expired": {
      return translate("mcp.statusExpired");
    }
    case "revoked": {
      return translate("mcp.statusRevoked");
    }
    case "none": {
      return translate("mcp.statusNeedsAuthorization");
    }
    default: {
      return unreachableCase(s, "Unsupported MCP credential status.");
    }
  }
}

function unreachableCase(_value: never, message: string): never {
  throw new Error(message);
}
