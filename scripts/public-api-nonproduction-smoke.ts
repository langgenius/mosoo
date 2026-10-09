const PRODUCTION_HOSTS = new Set(["cloud.mosoo.ai", "mosoo.ai", "try.mosoo.ai"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }

  return value;
}

export function assertNonProductionBaseUrl(value: string, version: "v1" | "v2" = "v1"): URL {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("Public API smoke base URL must use HTTPS.");
  }

  if (PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to run Public API smoke against production host ${url.hostname}.`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");

  if (!normalizedPath.endsWith(`/api/${version}`)) {
    throw new Error(`Public API smoke base URL must end in /api/${version}.`);
  }

  url.pathname = normalizedPath;
  url.search = "";
  url.hash = "";
  return url;
}

export function createSmokeThreadBody(userId: string, inputText?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { userId };

  if (inputText) {
    body["input"] = {
      content: [{ text: inputText, type: "text" }],
      type: "user.message",
    };
  }

  return body;
}

async function readJson(response: Response, label: string): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON (HTTP ${response.status}).`);
  }
}

async function main(): Promise<void> {
  const baseUrlValue = process.env["MOSOO_PUBLIC_API_SMOKE_BASE_URL"]?.trim();
  const agentId = process.env["MOSOO_PUBLIC_API_SMOKE_AGENT_ID"]?.trim();
  const token = process.env["MOSOO_PUBLIC_API_SMOKE_TOKEN"]?.trim();
  const userId = process.env["MOSOO_PUBLIC_API_SMOKE_USER_ID"]?.trim() || "contract-smoke";
  const inputText = process.env["MOSOO_PUBLIC_API_SMOKE_INPUT_TEXT"]?.trim();

  if (!baseUrlValue || !agentId || !token) {
    throw new Error(
      "MOSOO_PUBLIC_API_SMOKE_BASE_URL, MOSOO_PUBLIC_API_SMOKE_AGENT_ID, and MOSOO_PUBLIC_API_SMOKE_TOKEN are required.",
    );
  }

  const baseUrl = assertNonProductionBaseUrl(baseUrlValue);
  const createResponse = await fetch(
    new URL(`${baseUrl.pathname}/agents/${encodeURIComponent(agentId)}/threads`, baseUrl),
    {
      body: JSON.stringify(createSmokeThreadBody(userId, inputText)),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `contract-smoke-${crypto.randomUUID()}`,
      },
      method: "POST",
    },
  );
  const createResult = requireRecord(
    await readJson(createResponse, "Non-production create Thread"),
    "create Thread response",
  );

  if (createResponse.status !== 201) {
    throw new Error(`Non-production create Thread failed with HTTP ${createResponse.status}.`);
  }

  const thread = requireRecord(createResult["thread"], "created Thread");

  if (thread["userId"] !== userId || typeof thread["id"] !== "string") {
    throw new Error("Created Thread did not preserve the documented userId contract.");
  }

  if (inputText ? !isRecord(createResult["run"]) : createResult["run"] !== null) {
    throw new Error(
      inputText
        ? "Create Thread smoke with input did not start a Run."
        : "Minimal create Thread smoke unexpectedly started a Run.",
    );
  }

  console.log(`Public API non-production smoke passed for ${baseUrl.origin}${baseUrl.pathname}.`);
}

if (import.meta.main) {
  await main();
}
