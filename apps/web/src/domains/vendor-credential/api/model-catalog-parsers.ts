import type { AvailableModelReason, ModelCatalogSource } from "./vendor-credential-client";

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
    default: {
      throw new Error(`Unsupported available model reason: ${reason}`);
    }
  }
}

export function parseModelCatalogSource(source: string): ModelCatalogSource {
  switch (source) {
    case "custom": {
      return source;
    }
    case "preset": {
      return source;
    }
    default: {
      throw new Error(`Unsupported model catalog source: ${source}`);
    }
  }
}
