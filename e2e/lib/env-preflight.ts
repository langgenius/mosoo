export type PreviewProviderId = "anthropic" | "openai";

export interface HarnessErrorInput {
  readonly fix: string;
  readonly what: string;
  readonly why: string;
}

export interface PreviewRuntimeCredential {
  apiKey: string;
  providerId: PreviewProviderId;
  runtimeButtonName: string;
}

export function formatHarnessError(input: HarnessErrorInput): string {
  return [`WHAT: ${input.what}`, `WHY: ${input.why}`, `FIX: ${input.fix}`].join("\n");
}

export function readPreviewProviderId(): PreviewProviderId {
  const provider = process.env["MOSOO_E2E_PROVIDER"]?.trim() ?? "";

  if (provider === "" || provider === "openai") {
    return "openai";
  }

  if (provider === "anthropic") {
    return "anthropic";
  }

  throw new Error(
    formatHarnessError({
      fix: "Set `MOSOO_E2E_PROVIDER=openai` or `MOSOO_E2E_PROVIDER=anthropic`.",
      what: `Preview live runtime smoke cannot start because MOSOO_E2E_PROVIDER=${provider} is unsupported.`,
      why: "The live harness must select a concrete public runtime provider before creating an agent.",
    }),
  );
}

export function readProviderApiKey(providerId: PreviewProviderId): string {
  return (
    process.env["MOSOO_E2E_PROVIDER_API_KEY"]?.trim() ||
    (providerId === "anthropic"
      ? process.env["MOSOO_E2E_ANTHROPIC_API_KEY"]?.trim()
      : process.env["MOSOO_E2E_OPENAI_API_KEY"]?.trim()) ||
    ""
  );
}

export function requirePreviewRuntimeCredential(): PreviewRuntimeCredential {
  const providerId = readPreviewProviderId();
  const providerKey = readProviderApiKey(providerId);

  if (providerKey.length === 0) {
    throw new Error(
      formatHarnessError({
        fix: "Set `MOSOO_E2E_PROVIDER=anthropic MOSOO_E2E_PROVIDER_API_KEY=...`, or `MOSOO_E2E_PROVIDER=openai MOSOO_E2E_PROVIDER_API_KEY=...`.",
        what: "Preview live runtime smoke cannot start because the provider credential is missing.",
        why: "Live runtime smoke must run against the provider that owns the selected agent.",
      }),
    );
  }

  return {
    apiKey: providerKey,
    providerId,
    runtimeButtonName: providerId === "anthropic" ? "Claude" : "OpenAI",
  };
}

export function requireProviderRuntimeEnv(label: string): void {
  const providerId = readPreviewProviderId();

  if (readProviderApiKey(providerId).length > 0) {
    return;
  }

  const providerSpecificKey =
    providerId === "anthropic" ? "MOSOO_E2E_ANTHROPIC_API_KEY" : "MOSOO_E2E_OPENAI_API_KEY";

  throw new Error(
    `${label} requires MOSOO_E2E_PROVIDER_API_KEY or ${providerSpecificKey} for MOSOO_E2E_PROVIDER=${providerId}.`,
  );
}

export function requirePiRuntimeSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { apiKey: string; apiBase: string; model: string; runtimeId: "pi" } {
  const runtimeId = env["MOSOO_E2E_RUNTIME_ID"]?.trim() || "pi";

  if (runtimeId !== "pi") {
    throw new Error("MOSOO_E2E_PROVIDER=pi requires MOSOO_E2E_RUNTIME_ID=pi (or unset).");
  }

  const model = env["MOSOO_E2E_PI_MODEL"]?.trim();
  const apiBase = env["MOSOO_E2E_PI_BASE_URL"]?.trim();

  if (!model || !apiBase) {
    throw new Error(
      "Pi runtime E2E requires MOSOO_E2E_PI_MODEL and MOSOO_E2E_PI_BASE_URL for a custom OpenAI-compatible model.",
    );
  }

  const apiKey = env["MOSOO_E2E_PROVIDER_API_KEY"]?.trim() || env["MOSOO_E2E_PI_API_KEY"]?.trim();

  if (!apiKey) {
    throw new Error("Pi runtime E2E requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_PI_API_KEY.");
  }

  return { apiKey, apiBase, model, runtimeId };
}
