import type { PresetModelProtocol } from "@mosoo/contracts/models";

import type { AvailableModelReason } from "./vendor-credential-client";

export function parseModelProtocol(protocol: string | null): PresetModelProtocol | null {
  switch (protocol) {
    case null:
    case "anthropic-messages":
    case "google-gemini":
    case "openai-chat-completions":
    case "openai-responses": {
      return protocol;
    }
    default: {
      throw new Error(`Unsupported model protocol: ${protocol}`);
    }
  }
}

export function parseAvailableModelReason(reason: string | null): AvailableModelReason | null {
  if (reason === null) {
    return null;
  }

  switch (reason) {
    case "needs-key": {
      return reason;
    }
    case "unknown-model": {
      return reason;
    }
    case "unknown-provider": {
      return reason;
    }
    case "wrong-runtime": {
      return reason;
    }
    case "wrong-protocol": {
      return reason;
    }
    default: {
      throw new Error(`Unsupported available model reason: ${reason}`);
    }
  }
}
