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

export function assertNonProductionBaseUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("Public API smoke base URL must use HTTPS.");
  }

  if (PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to run Public API smoke against production host ${url.hostname}.`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");

  if (!normalizedPath.endsWith("/api/v1")) {
    throw new Error("Public API smoke base URL must end in /api/v1.");
  }

  url.pathname = normalizedPath;
  url.search = "";
  url.hash = "";
  return url;
}

export function assertCreateThreadContract(documentValue: unknown): void {
  const document = requireRecord(documentValue, "OpenAPI document");
  const components = requireRecord(document["components"], "OpenAPI components");
  const schemas = requireRecord(components["schemas"], "OpenAPI schemas");
  const createSchema = requireRecord(schemas["CreateThreadRequest"], "CreateThreadRequest");
  const properties = requireRecord(createSchema["properties"], "CreateThreadRequest properties");
  const required = createSchema["required"];

  if (
    JSON.stringify(Object.keys(properties).toSorted()) !==
    JSON.stringify(["input", "resources", "userId"])
  ) {
    throw new Error("Live CreateThreadRequest allowed fields do not match the canonical contract.");
  }

  if (!Array.isArray(required) || JSON.stringify(required) !== JSON.stringify(["userId"])) {
    throw new Error("Live CreateThreadRequest must require exactly userId.");
  }

  if (createSchema["additionalProperties"] !== false) {
    throw new Error("Live CreateThreadRequest must reject unsupported fields.");
  }

  const paths = requireRecord(document["paths"], "OpenAPI paths");
  const createPath = requireRecord(paths["/agents/{agentId}/threads"], "create Thread path");
  const createOperation = requireRecord(createPath["post"], "create Thread operation");
  const requestBody = requireRecord(createOperation["requestBody"], "create Thread request body");

  if (requestBody["required"] !== true) {
    throw new Error("Live create Thread requestBody must be required.");
  }
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

  if (!baseUrlValue || !agentId || !token) {
    throw new Error(
      "MOSOO_PUBLIC_API_SMOKE_BASE_URL, MOSOO_PUBLIC_API_SMOKE_AGENT_ID, and MOSOO_PUBLIC_API_SMOKE_TOKEN are required.",
    );
  }

  const baseUrl = assertNonProductionBaseUrl(baseUrlValue);
  const openApiResponse = await fetch(new URL(`${baseUrl.pathname}/openapi.json`, baseUrl), {
    headers: { Accept: "application/json" },
  });

  if (!openApiResponse.ok) {
    throw new Error(`Non-production OpenAPI request failed with HTTP ${openApiResponse.status}.`);
  }

  assertCreateThreadContract(await readJson(openApiResponse, "Non-production OpenAPI"));

  const createResponse = await fetch(
    new URL(`${baseUrl.pathname}/agents/${encodeURIComponent(agentId)}/threads`, baseUrl),
    {
      body: JSON.stringify({ userId }),
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

  if (createResult["run"] !== null) {
    throw new Error("Minimal create Thread smoke unexpectedly started a Run.");
  }

  console.log(`Public API non-production smoke passed for ${baseUrl.origin}${baseUrl.pathname}.`);
}

if (import.meta.main) {
  await main();
}
