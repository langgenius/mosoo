import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";

import type { ApiBindings } from "./worker-types";

type CloudflareSandboxNamespace = DurableObjectNamespace<CloudflareSandbox>;

export function requireCloudflareSandboxBinding(env: ApiBindings): CloudflareSandboxNamespace {
  const binding = env.Sandbox;

  if (binding === undefined) {
    throw new Error("Sandbox binding is not configured in wrangler.toml.");
  }

  // The wrapper DO forwards the SDK surface dynamically, so its declared shape
  // stops overlapping the SDK stub type once it defines methods of its own.
  return binding as unknown as CloudflareSandboxNamespace;
}
