import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";
import { isSupportedDriverRuntime } from "@mosoo/agent-driver/runtime";
import type { DriverRuntime } from "@mosoo/agent-driver/runtime";

import type { Sandbox } from "../../adapters/durable-objects/sandbox.do";
import type { ApiBindings } from "./worker-types";

type CloudflareSandboxNamespace = DurableObjectNamespace<CloudflareSandbox>;

export const RUNTIME_SANDBOX_IMAGES = {
  "claude-agent-sdk": { binding: "SandboxClaude", profile: "claude" },
  "openai-runtime": { binding: "SandboxOpenAI", profile: "openai" },
  "acp-fallback": { binding: "SandboxOpenCode", profile: "opencode" },
} as const satisfies Record<DriverRuntime, { binding: keyof ApiBindings; profile: string }>;

export type SandboxBinding = "Sandbox" | (typeof RUNTIME_SANDBOX_IMAGES)[DriverRuntime]["binding"];

export function runtimeImagesEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function sandboxBindingForRuntime(runtimeId: string): SandboxBinding {
  if (!isSupportedDriverRuntime(runtimeId)) {
    throw new Error(`No Sandbox image for runtime: ${runtimeId}.`);
  }
  return RUNTIME_SANDBOX_IMAGES[runtimeId].binding;
}

export function requireSandboxBinding(
  env: ApiBindings,
  name: string = "Sandbox",
): DurableObjectNamespace<Sandbox> {
  const bindingName =
    name === "Sandbox"
      ? name
      : Object.values(RUNTIME_SANDBOX_IMAGES).find((image) => image.binding === name)?.binding;
  if (bindingName === undefined) {
    throw new Error(`Unknown Sandbox binding: ${name}.`);
  }
  const binding = env[bindingName];

  if (binding === undefined) {
    throw new Error(`${name} binding is not configured in wrangler.toml.`);
  }

  return binding;
}

export function requireCloudflareSandboxBinding(
  env: ApiBindings,
  name: string = "Sandbox",
): CloudflareSandboxNamespace {
  // The wrapper DO forwards the SDK surface dynamically, so its declared shape
  // stops overlapping the SDK stub type once it defines methods of its own.
  return requireSandboxBinding(env, name) as unknown as CloudflareSandboxNamespace;
}
