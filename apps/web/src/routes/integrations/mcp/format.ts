import type { McpAuthType } from "@mosoo/contracts/mcp";

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

function unreachableCase(_value: never, message: string): never {
  throw new Error(message);
}
