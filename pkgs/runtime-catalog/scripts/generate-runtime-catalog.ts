import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_PATH = join(PACKAGE_ROOT, "catalog/runtime-catalog.jsonc");
const GENERATED_PATH = join(PACKAGE_ROOT, "src/catalog.generated.ts");

const MODEL_PROTOCOLS = new Set([
  "anthropic-messages",
  "google-gemini",
  "openai-chat-completions",
  "openai-responses",
]);

const CAPABILITY_IDS = new Set([
  "custom_tool_execute",
  "input_start",
  "mcp_execute",
  "native_resume",
  "permission_request",
  "session_stop",
  "thinking_stream",
  "text_stream",
  "tool_stream",
  "turn_cancel",
  "usage",
  "visible_activity",
]);

const TRANSPORTS = new Set(["openai-app-server", "claude-agent-sdk", "acp-fallback"]);
const VISIBILITIES = new Set(["internal", "public"]);
const SURFACES = new Set(["landing", "provider-settings"]);

interface RawCatalog {
  capabilityProfiles: Record<string, RawCapability[]>;
  modelDefaults: Record<string, string>;
  models: RawModel[];
  plannedRuntimes: RawPlannedRuntime[];
  runtimes: RawRuntime[];
  vendors: RawVendor[];
}

interface RawCapability {
  id: string;
  status: string;
  version: number;
}

interface RawVendor {
  apiBaseEnvVar?: string;
  apiKeyEnvVar: string;
  authHeader: unknown;
  defaultApiBase?: string;
  iconKey: string;
  label: string;
  modelSource?: RawVendorModelSource;
  openCodeProvider?: RawOpenCodeProvider;
  vendorId: string;
}

type RawVendorModelSource =
  | {
      kind: "manual";
    }
  | {
      kind: "models.dev";
      providerId: string;
    };

interface RawOpenCodeProvider {
  apiBaseOption?: "baseURL";
  name: string;
  npmPackage: string;
  providerId?: string;
}

interface RawModel {
  displayName: string;
  modelId: string;
  protocol: string;
  vendorId: string;
}

interface RawRuntime {
  acceptsCustomProvider: boolean;
  capabilityProfile: string;
  defaultIdentity: {
    modelId: string;
    providerId: string;
  };
  disabledReason?: string;
  display: {
    color?: string;
    iconKey: string;
    providerLabel?: string;
    showcaseLabel?: string;
  };
  label: string;
  runtimeId: string;
  supportedModels: {
    modelIds?: string[];
    vendorIds?: string[];
  };
  transport: string;
  vendorIds: string[];
  visibility: string;
}

interface RawPlannedRuntime {
  iconKey: string;
  label: string;
  providerLabel: string;
  runtimeId: string;
  surfaces: string[];
}

interface GeneratedCatalog {
  modelDefaultIds: Record<string, string>;
  plannedRuntimeDisplayCatalog: RawPlannedRuntime[];
  presetModelCatalog: Array<RawModel & { vendorLabel: string }>;
  runtimeCatalog: Array<
    Omit<RawRuntime, "capabilityProfile" | "supportedModels" | "vendorIds"> & {
      capabilities: RawCapability[];
      supportedModelIds: string[];
      vendorIds: string[];
    }
  >;
  vendorCatalog: RawVendor[];
}

function fail(message: string): never {
  throw new Error(`Runtime catalog generation failed: ${message}`);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }

  return value;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readString(value, label);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean.`);
  }

  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }

  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  return readArray(value, label).map((item, index) => readString(item, `${label}[${index}]`));
}

function readUniqueStringArray(value: unknown, label: string): string[] {
  const items = readStringArray(value, label);
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item)) {
      fail(`${label} contains duplicate value ${item}.`);
    }

    seen.add(item);
  }

  return items;
}

function assertKnown(value: string, known: ReadonlySet<string>, label: string): void {
  if (!known.has(value)) {
    fail(`${label} has unsupported value ${value}.`);
  }
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();

  for (const item of items) {
    const value = key(item);

    if (seen.has(value)) {
      fail(`${label} contains duplicate id ${value}.`);
    }

    seen.add(value);
  }
}

function readAuthHeader(value: unknown, label: string): RawVendor["authHeader"] {
  const record = readRecord(value, label);
  const scheme = readString(record["scheme"], `${label}.scheme`);

  if (scheme === "bearer") {
    const apiKeyHeader = readString(record["apiKeyHeader"], `${label}.apiKeyHeader`);

    if (apiKeyHeader !== "Authorization") {
      fail(`${label}.apiKeyHeader must be Authorization for bearer auth.`);
    }

    return { apiKeyHeader, scheme };
  }

  if (scheme === "api-key") {
    const apiKeyHeader = readString(record["apiKeyHeader"], `${label}.apiKeyHeader`);
    const extraHeadersValue = record["extraHeaders"];
    const extraHeadersRecord =
      extraHeadersValue === undefined ? {} : readRecord(extraHeadersValue, `${label}.extraHeaders`);
    const extraHeaders: Record<string, string> = {};

    for (const [key, headerValue] of Object.entries(extraHeadersRecord)) {
      extraHeaders[key] = readString(headerValue, `${label}.extraHeaders.${key}`);
    }

    return { apiKeyHeader, extraHeaders, scheme };
  }

  fail(`${label}.scheme must be bearer or api-key.`);
}

function readVendorModelSource(value: unknown, label: string): RawVendorModelSource | undefined {
  if (value === undefined) {
    return undefined;
  }

  const source = readRecord(value, label);
  const kind = readString(source["kind"], `${label}.kind`);

  if (kind === "manual") {
    return { kind };
  }

  if (kind === "models.dev") {
    return {
      kind,
      providerId: readString(source["providerId"], `${label}.providerId`),
    };
  }

  fail(`${label}.kind must be manual or models.dev.`);
}

function readOpenCodeProvider(value: unknown, label: string): RawOpenCodeProvider | undefined {
  if (value === undefined) {
    return undefined;
  }

  const provider = readRecord(value, label);
  const apiBaseOption =
    provider["apiBaseOption"] === undefined
      ? undefined
      : readString(provider["apiBaseOption"], `${label}.apiBaseOption`);

  if (apiBaseOption !== undefined && apiBaseOption !== "baseURL") {
    fail(`${label}.apiBaseOption must be baseURL.`);
  }
  const providerId = readOptionalString(provider["providerId"], `${label}.providerId`);

  return {
    ...(apiBaseOption === undefined ? {} : { apiBaseOption }),
    name: readString(provider["name"], `${label}.name`),
    npmPackage: readString(provider["npmPackage"], `${label}.npmPackage`),
    ...(providerId === undefined ? {} : { providerId }),
  };
}

function parseSource(): RawCatalog {
  const errors: ParseError[] = [];
  const value = parseJsonc(readFileSync(SOURCE_PATH, "utf8"), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const message = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    fail(message);
  }

  const record = readRecord(value, "catalog");

  return {
    capabilityProfiles: readCapabilityProfiles(record["capabilityProfiles"]),
    modelDefaults: readStringRecord(record["modelDefaults"], "catalog.modelDefaults"),
    models: readModels(record["models"]),
    plannedRuntimes: readPlannedRuntimes(record["plannedRuntimes"]),
    runtimes: readRuntimes(record["runtimes"]),
    vendors: readVendors(record["vendors"]),
  };
}

function readStringRecord(value: unknown, label: string): Record<string, string> {
  const record = readRecord(value, label);
  const result: Record<string, string> = {};

  for (const [key, item] of Object.entries(record)) {
    result[key] = readString(item, `${label}.${key}`);
  }

  return result;
}

function readCapabilityProfiles(value: unknown): Record<string, RawCapability[]> {
  const record = readRecord(value, "catalog.capabilityProfiles");
  const profiles: Record<string, RawCapability[]> = {};

  for (const [profileId, profileValue] of Object.entries(record)) {
    profiles[profileId] = readArray(profileValue, `capabilityProfiles.${profileId}`).map(
      (item, index) => {
        const capability = readRecord(item, `capabilityProfiles.${profileId}[${index}]`);
        const id = readString(capability["id"], `capabilityProfiles.${profileId}[${index}].id`);
        const status = readString(
          capability["status"],
          `capabilityProfiles.${profileId}[${index}].status`,
        );
        const version = capability["version"];

        assertKnown(id, CAPABILITY_IDS, `capabilityProfiles.${profileId}[${index}].id`);

        if (status !== "supported" && status !== "unsupported") {
          fail(
            `capabilityProfiles.${profileId}[${index}].status must be supported or unsupported.`,
          );
        }

        if (version !== 1) {
          fail(`capabilityProfiles.${profileId}[${index}].version must be 1.`);
        }

        return { id, status, version };
      },
    );
  }

  return profiles;
}

function readVendors(value: unknown): RawVendor[] {
  return readArray(value, "catalog.vendors").map((item, index) => {
    const vendor = readRecord(item, `vendors[${index}]`);
    const defaultApiBase = readOptionalString(
      vendor["defaultApiBase"],
      `vendors[${index}].defaultApiBase`,
    );
    const openCodeProvider = readOpenCodeProvider(
      vendor["openCodeProvider"],
      `vendors[${index}].openCodeProvider`,
    );
    const vendorId = readString(vendor["vendorId"], `vendors[${index}].vendorId`);

    if (
      openCodeProvider?.apiBaseOption === "baseURL" &&
      defaultApiBase === undefined &&
      vendorId !== "openai-compatible"
    ) {
      fail(
        `vendors[${index}].openCodeProvider.apiBaseOption requires defaultApiBase unless the vendor is openai-compatible.`,
      );
    }

    return {
      apiBaseEnvVar: readOptionalString(vendor["apiBaseEnvVar"], `vendors[${index}].apiBaseEnvVar`),
      apiKeyEnvVar: readString(vendor["apiKeyEnvVar"], `vendors[${index}].apiKeyEnvVar`),
      authHeader: readAuthHeader(vendor["authHeader"], `vendors[${index}].authHeader`),
      defaultApiBase,
      iconKey: readString(vendor["iconKey"], `vendors[${index}].iconKey`),
      label: readString(vendor["label"], `vendors[${index}].label`),
      modelSource: readVendorModelSource(vendor["modelSource"], `vendors[${index}].modelSource`),
      openCodeProvider,
      vendorId,
    };
  });
}

function readModels(value: unknown): RawModel[] {
  return readArray(value, "catalog.models").map((item, index) => {
    const model = readRecord(item, `models[${index}]`);
    const protocol = readString(model["protocol"], `models[${index}].protocol`);

    assertKnown(protocol, MODEL_PROTOCOLS, `models[${index}].protocol`);

    return {
      displayName: readString(model["displayName"], `models[${index}].displayName`),
      modelId: readString(model["modelId"], `models[${index}].modelId`),
      protocol,
      vendorId: readString(model["vendorId"], `models[${index}].vendorId`),
    };
  });
}

function readRuntimes(value: unknown): RawRuntime[] {
  return readArray(value, "catalog.runtimes").map((item, index) => {
    const runtime = readRecord(item, `runtimes[${index}]`);
    const display = readRecord(runtime["display"], `runtimes[${index}].display`);
    const defaultIdentity = readRecord(
      runtime["defaultIdentity"],
      `runtimes[${index}].defaultIdentity`,
    );
    const supportedModels = readRecord(
      runtime["supportedModels"],
      `runtimes[${index}].supportedModels`,
    );
    const transport = readString(runtime["transport"], `runtimes[${index}].transport`);
    const visibility = readString(runtime["visibility"], `runtimes[${index}].visibility`);

    assertKnown(transport, TRANSPORTS, `runtimes[${index}].transport`);
    assertKnown(visibility, VISIBILITIES, `runtimes[${index}].visibility`);

    return {
      acceptsCustomProvider: readBoolean(
        runtime["acceptsCustomProvider"],
        `runtimes[${index}].acceptsCustomProvider`,
      ),
      capabilityProfile: readString(
        runtime["capabilityProfile"],
        `runtimes[${index}].capabilityProfile`,
      ),
      defaultIdentity: {
        modelId: readString(
          defaultIdentity["modelId"],
          `runtimes[${index}].defaultIdentity.modelId`,
        ),
        providerId: readString(
          defaultIdentity["providerId"],
          `runtimes[${index}].defaultIdentity.providerId`,
        ),
      },
      disabledReason: readOptionalString(
        runtime["disabledReason"],
        `runtimes[${index}].disabledReason`,
      ),
      display: {
        color: readOptionalString(display["color"], `runtimes[${index}].display.color`),
        iconKey: readString(display["iconKey"], `runtimes[${index}].display.iconKey`),
        providerLabel: readOptionalString(
          display["providerLabel"],
          `runtimes[${index}].display.providerLabel`,
        ),
        showcaseLabel: readOptionalString(
          display["showcaseLabel"],
          `runtimes[${index}].display.showcaseLabel`,
        ),
      },
      label: readString(runtime["label"], `runtimes[${index}].label`),
      runtimeId: readString(runtime["runtimeId"], `runtimes[${index}].runtimeId`),
      supportedModels: {
        modelIds:
          supportedModels["modelIds"] === undefined
            ? undefined
            : readUniqueStringArray(
                supportedModels["modelIds"],
                `runtimes[${index}].supportedModels.modelIds`,
              ),
        vendorIds:
          supportedModels["vendorIds"] === undefined
            ? undefined
            : readUniqueStringArray(
                supportedModels["vendorIds"],
                `runtimes[${index}].supportedModels.vendorIds`,
              ),
      },
      transport,
      vendorIds: readUniqueStringArray(runtime["vendorIds"], `runtimes[${index}].vendorIds`),
      visibility,
    };
  });
}

function readPlannedRuntimes(value: unknown): RawPlannedRuntime[] {
  return readArray(value, "catalog.plannedRuntimes").map((item, index) => {
    const runtime = readRecord(item, `plannedRuntimes[${index}]`);
    const surfaces = readUniqueStringArray(
      runtime["surfaces"],
      `plannedRuntimes[${index}].surfaces`,
    );

    for (const surface of surfaces) {
      assertKnown(surface, SURFACES, `plannedRuntimes[${index}].surfaces`);
    }

    return {
      iconKey: readString(runtime["iconKey"], `plannedRuntimes[${index}].iconKey`),
      label: readString(runtime["label"], `plannedRuntimes[${index}].label`),
      providerLabel: readString(
        runtime["providerLabel"],
        `plannedRuntimes[${index}].providerLabel`,
      ),
      runtimeId: readString(runtime["runtimeId"], `plannedRuntimes[${index}].runtimeId`),
      surfaces,
    };
  });
}

function createGeneratedCatalog(catalog: RawCatalog): GeneratedCatalog {
  assertUnique(catalog.vendors, (vendor) => vendor.vendorId, "vendors");
  assertUnique(catalog.models, (model) => `${model.vendorId}:${model.modelId}`, "models");
  assertUnique(catalog.runtimes, (runtime) => runtime.runtimeId, "runtimes");
  assertUnique(catalog.plannedRuntimes, (runtime) => runtime.runtimeId, "plannedRuntimes");

  const vendorsById = new Map(catalog.vendors.map((vendor) => [vendor.vendorId, vendor]));
  const modelsByVendor = new Map<string, RawModel[]>();
  const modelKeys = new Set<string>();

  for (const model of catalog.models) {
    const vendor = vendorsById.get(model.vendorId);

    if (!vendor) {
      fail(`Model ${model.modelId} references unknown vendor ${model.vendorId}.`);
    }

    modelKeys.add(modelKey(model.vendorId, model.modelId));
    modelsByVendor.set(model.vendorId, [...(modelsByVendor.get(model.vendorId) ?? []), model]);
  }

  for (const [vendorId, modelId] of Object.entries(catalog.modelDefaults)) {
    if (!modelKeys.has(modelKey(vendorId, modelId))) {
      fail(`modelDefaults.${vendorId} references unknown model ${modelId}.`);
    }
  }

  const runtimeCatalog = catalog.runtimes.map((runtime) => {
    const capabilities = catalog.capabilityProfiles[runtime.capabilityProfile];

    if (capabilities === undefined) {
      fail(
        `Runtime ${runtime.runtimeId} references unknown capability profile ${runtime.capabilityProfile}.`,
      );
    }

    for (const vendorId of runtime.vendorIds) {
      if (!vendorsById.has(vendorId)) {
        fail(`Runtime ${runtime.runtimeId} references unknown vendor ${vendorId}.`);
      }
    }

    if (!runtime.vendorIds.includes(runtime.defaultIdentity.providerId)) {
      fail(`Runtime ${runtime.runtimeId} default provider is not listed in vendorIds.`);
    }

    if (
      !modelKeys.has(modelKey(runtime.defaultIdentity.providerId, runtime.defaultIdentity.modelId))
    ) {
      fail(`Runtime ${runtime.runtimeId} default identity references an unknown preset model.`);
    }

    const supportedModelIds = resolveSupportedModelIds(runtime, modelsByVendor);

    if (!supportedModelIds.includes(runtime.defaultIdentity.modelId)) {
      fail(
        `Runtime ${runtime.runtimeId} default model is not supported by its supportedModels scope.`,
      );
    }

    const {
      capabilityProfile: _capabilityProfile,
      supportedModels: _supportedModels,
      ...base
    } = runtime;

    return {
      ...base,
      capabilities,
      supportedModelIds,
    };
  });

  return {
    modelDefaultIds: catalog.modelDefaults,
    plannedRuntimeDisplayCatalog: catalog.plannedRuntimes,
    presetModelCatalog: catalog.models.map((model) => {
      const vendor = vendorsById.get(model.vendorId);

      if (!vendor) {
        fail(`Model ${model.modelId} references unknown vendor ${model.vendorId}.`);
      }

      return {
        ...model,
        vendorLabel: vendor.label,
      };
    }),
    runtimeCatalog,
    vendorCatalog: catalog.vendors,
  };
}

function modelKey(vendorId: string, modelId: string): string {
  return `${vendorId}:${modelId}`;
}

function resolveSupportedModelIds(
  runtime: RawRuntime,
  modelsByVendor: ReadonlyMap<string, readonly RawModel[]>,
): string[] {
  const modelIds: string[] = [];

  for (const vendorId of runtime.supportedModels.vendorIds ?? []) {
    const models = modelsByVendor.get(vendorId);

    if (models === undefined) {
      fail(`Runtime ${runtime.runtimeId} supportedModels references unknown vendor ${vendorId}.`);
    }

    for (const model of models) {
      modelIds.push(model.modelId);
    }
  }

  modelIds.push(...(runtime.supportedModels.modelIds ?? []));

  return [...new Set(modelIds)];
}

function renderGeneratedCatalog(catalog: GeneratedCatalog): string {
  return `// Generated by pkgs/runtime-catalog/scripts/generate-runtime-catalog.ts.\n// Source: pkgs/runtime-catalog/catalog/runtime-catalog.jsonc\n// Do not edit this file by hand.\n\nexport const GENERATED_MODEL_DEFAULT_IDS = ${literal(catalog.modelDefaultIds)} as const;\n\nexport const GENERATED_VENDOR_CATALOG = ${literal(catalog.vendorCatalog)} as const;\n\nexport const GENERATED_PRESET_MODEL_CATALOG = ${literal(catalog.presetModelCatalog)} as const;\n\nexport const GENERATED_RUNTIME_CATALOG = ${literal(catalog.runtimeCatalog)} as const;\n\nexport const GENERATED_PLANNED_RUNTIME_DISPLAY_CATALOG = ${literal(catalog.plannedRuntimeDisplayCatalog)} as const;\n`;
}

function literal(value: unknown, depth = 0): string {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return arrayLiteral(value, depth);
  }

  const record = readRecord(value, "generated value");
  const indent = indentation(depth);
  const childIndent = indentation(depth + 1);
  const entries = Object.entries(record).filter(([, item]) => item !== undefined);

  if (entries.length === 0) {
    return "{}";
  }

  return `{\n${entries
    .map(([key, item]) => `${childIndent}${objectKey(key)}: ${literal(item, depth + 1)},`)
    .join("\n")}\n${indent}}`;
}

function arrayLiteral(items: readonly unknown[], depth: number): string {
  if (items.length === 0) {
    return "[]";
  }

  if (items.every(isPrimitiveLiteral)) {
    const inline = `[${items.map((item) => literal(item, depth)).join(", ")}]`;

    if (inline.length + indentation(depth).length <= 80) {
      return inline;
    }
  }

  const indent = indentation(depth);
  const childIndent = indentation(depth + 1);

  return `[\n${items.map((item) => `${childIndent}${literal(item, depth + 1)},`).join("\n")}\n${indent}]`;
}

function isPrimitiveLiteral(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function objectKey(key: string): string {
  return /^[A-Za-z_$][\dA-Za-z_$]*$/.test(key) ? key : JSON.stringify(key);
}

function indentation(depth: number): string {
  return "  ".repeat(depth);
}

function main(): void {
  const source = renderGeneratedCatalog(createGeneratedCatalog(parseSource()));
  const check = process.argv.includes("--check");

  if (check) {
    const current = existsSync(GENERATED_PATH) ? readFileSync(GENERATED_PATH, "utf8") : "";

    if (current !== source) {
      fail(`${GENERATED_PATH} is out of date. Run bun scripts/generate-runtime-catalog.ts.`);
    }

    return;
  }

  writeFileSync(GENERATED_PATH, source);
}

main();
