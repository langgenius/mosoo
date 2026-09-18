import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";

import type { ApiBindings } from "./worker-types";

type CloudflareSandboxNamespace = DurableObjectNamespace<CloudflareSandbox>;

export type SandboxBinding = "Sandbox" | "SandboxClaude" | "SandboxOpenAI" | "SandboxOpenCode";

export function runtimeImagesEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function sandboxBindingForRuntime(runtimeId: string): SandboxBinding {
  switch (runtimeId) {
    case "claude-agent-sdk":
      return "SandboxClaude";
    case "openai-runtime":
      return "SandboxOpenAI";
    case "acp-fallback":
      return "SandboxOpenCode";
    default:
      throw new Error(`No Sandbox image for runtime: ${runtimeId}.`);
  }
}

export function requireCloudflareSandboxBinding(
  env: ApiBindings,
  name: string = "Sandbox",
): CloudflareSandboxNamespace {
  if (
    name !== "Sandbox" &&
    name !== "SandboxClaude" &&
    name !== "SandboxOpenAI" &&
    name !== "SandboxOpenCode"
  ) {
    throw new Error(`Unknown Sandbox binding: ${name}.`);
  }
  const binding = env[name];

  if (binding === undefined) {
    throw new Error(`${name} binding is not configured in wrangler.toml.`);
  }

  // The wrapper DO forwards the SDK surface dynamically, so its declared shape
  // stops overlapping the SDK stub type once it defines methods of its own.
  return binding as unknown as CloudflareSandboxNamespace;
}
