import type {
  EnvironmentConfigInput,
  EnvironmentPackageManager,
  EnvironmentPackageSpec,
  EnvironmentRevisionConfig,
  EnvironmentVariableInput,
} from "@mosoo/contracts/environment";
import type { EnvironmentId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  readEnvironmentVariableSecret,
  storeEnvironmentVariableSecret,
} from "./environment-secret-store";
import type { EnvironmentMutableConfig, StoredEnvironmentVariable } from "./environment-types";

const PACKAGE_MANAGERS: readonly EnvironmentPackageManager[] = [
  "apt",
  "cargo",
  "gem",
  "go",
  "npm",
  "pip",
];
const PACKAGE_MANAGER_SET = new Set<string>(PACKAGE_MANAGERS);

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new TypeError(`${fieldName}.${index} must be a string.`);
    }
    return entry;
  });
}

function parseJson(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must contain valid JSON.`);
  }
}

export function parseStringArrayJson(value: string, fieldName: string): string[] {
  return parseStringArray(parseJson(value, fieldName), fieldName);
}

export function parsePackagesJson(value: string): EnvironmentPackageSpec[] {
  const parsed = parseJson(value, "packages");

  if (!Array.isArray(parsed)) {
    throw new TypeError("packages must be an array.");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`packages.${index} must be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const { manager } = record;

    if (typeof manager !== "string" || !PACKAGE_MANAGER_SET.has(manager)) {
      throw new Error(`packages.${index}.manager is invalid.`);
    }

    return {
      manager: manager as EnvironmentPackageManager,
      packages: parseStringArray(record["packages"], `packages.${index}.packages`),
    };
  });
}

export function parseStoredEnvVarsJson(value: string): StoredEnvironmentVariable[] {
  const parsed = parseJson(value, "envVars");

  if (!Array.isArray(parsed)) {
    throw new TypeError("envVars must be an array.");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`envVars.${index} must be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const { key } = record;
    const { preview } = record;
    const { secretId } = record;

    if (
      typeof key !== "string" ||
      typeof preview !== "string" ||
      (secretId !== null && typeof secretId !== "string")
    ) {
      throw new TypeError(`envVars.${index} has an invalid shape.`);
    }

    return {
      key,
      preview,
      secretId,
    };
  });
}

export function toPublicRevisionConfig(input: EnvironmentMutableConfig): EnvironmentRevisionConfig {
  return {
    allowMcpServers: input.allowMcpServers,
    allowPackageManagers: input.allowPackageManagers,
    allowedHosts: [...input.allowedHosts],
    envVars: input.envVars.map((envVar) => ({
      key: envVar.key,
      preview: envVar.preview,
      status: envVar.secretId === null ? "pending" : "configured",
    })),
    networkPolicy: input.networkPolicy,
    packages: input.packages.map((entry) => ({
      manager: entry.manager,
      packages: [...entry.packages],
    })),
    setupScript: input.setupScript,
  };
}

function normalizeName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Environment name is required.");
  }

  if (normalized.length > 80) {
    throw new Error("Environment name must be 80 characters or fewer.");
  }

  return normalized;
}

function normalizeDescription(description: string | null | undefined): string {
  const normalized = description?.trim() ?? "";

  if (normalized.length > 500) {
    throw new Error("Environment description must be 500 characters or fewer.");
  }

  return normalized;
}

function normalizeHost(host: string): string {
  const normalized = host.trim().toLowerCase();

  if (!normalized) {
    throw new Error("Allowed host cannot be empty.");
  }

  if (
    normalized.includes("://") ||
    normalized.includes(":") ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(normalized)
  ) {
    throw new Error("Allowed hosts must be domains without protocol or port.");
  }

  return normalized;
}

function normalizeAllowedHosts(hosts: string[]): string[] {
  return [...new Set(hosts.map(normalizeHost))];
}

function normalizePackages(packages: EnvironmentPackageSpec[]): EnvironmentPackageSpec[] {
  const normalized: EnvironmentPackageSpec[] = [];

  for (const entry of packages) {
    if (!PACKAGE_MANAGER_SET.has(entry.manager)) {
      throw new Error("Package manager must be apt, cargo, gem, go, npm, or pip.");
    }

    const specs = [...new Set(entry.packages.map((spec) => spec.trim()).filter(Boolean))];

    for (const spec of specs) {
      if (!/^[A-Za-z0-9._@/+=:-]+$/u.test(spec)) {
        throw new Error(`Package spec ${spec} contains unsupported characters.`);
      }
    }

    if (specs.length > 0) {
      normalized.push({
        manager: entry.manager,
        packages: specs,
      });
    }
  }

  return normalized;
}

function normalizeEnvVarKey(key: string): string {
  const normalized = key.trim();

  if (!normalized) {
    throw new Error("Environment variable key is required.");
  }

  if (!/^[A-Z_][A-Z0-9_]*$/u.test(normalized)) {
    throw new Error(`Environment variable ${normalized} must use shell-style uppercase naming.`);
  }

  return normalized;
}

function previewSecret(value: string): string {
  if (value.length <= 8) {
    return "•••";
  }

  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function serializeEnvVars(envVars: StoredEnvironmentVariable[]): string {
  return JSON.stringify(envVars);
}

export function normalizeEnvironmentMetadata(input: {
  description?: string | null;
  name: string;
}): { description: string; name: string } {
  return {
    description: normalizeDescription(input.description),
    name: normalizeName(input.name),
  };
}

export function normalizeEnvironmentConfigInput(
  input: EnvironmentConfigInput,
): Omit<EnvironmentMutableConfig, "envVars"> {
  if (input.networkPolicy !== "full" && input.networkPolicy !== "limited") {
    throw new Error("Network policy must be full or limited.");
  }

  return {
    allowMcpServers: input.allowMcpServers,
    allowPackageManagers: input.allowPackageManagers,
    allowedHosts:
      input.networkPolicy === "limited" ? normalizeAllowedHosts(input.allowedHosts) : [],
    networkPolicy: input.networkPolicy,
    packages: normalizePackages(input.packages),
    setupScript: input.setupScript,
  };
}

export async function buildStoredEnvVars(
  bindings: ApiBindings,
  input: {
    envVars: EnvironmentVariableInput[];
    environmentId: EnvironmentId;
    previousEnvVars?: StoredEnvironmentVariable[];
  },
): Promise<StoredEnvironmentVariable[]> {
  const previousByKey = new Map(input.previousEnvVars?.map((envVar) => [envVar.key, envVar]));
  const stored: StoredEnvironmentVariable[] = [];
  const seenKeys = new Set<string>();

  for (const envVar of input.envVars) {
    const key = normalizeEnvVarKey(envVar.key);

    if (seenKeys.has(key)) {
      throw new Error(`Environment variable ${key} is duplicated.`);
    }

    seenKeys.add(key);

    const value = envVar.value ?? "";

    if (value.includes("\u0000")) {
      throw new Error(`Environment variable ${key} contains an invalid null character.`);
    }

    if (value) {
      const secretId = await storeEnvironmentVariableSecret(bindings, {
        environmentId: input.environmentId,
        envVarKey: key,
        value,
      });
      stored.push({
        key,
        preview: previewSecret(value),
        secretId,
      });
      continue;
    }

    const previous = previousByKey.get(key);

    stored.push(
      previous ?? {
        key,
        preview: "",
        secretId: null,
      },
    );
  }

  return stored;
}

export async function decryptEnvironmentVariables(
  bindings: ApiBindings,
  input: {
    environmentId: EnvironmentId;
    envVars: StoredEnvironmentVariable[];
  },
): Promise<Record<string, string>> {
  // Decrypt all secrets concurrently. Each readEnvironmentVariableSecret does
  // D1 reads + an AES-GCM unwrap; run serially this was N sequential D1
  // round-trips per hydration (the dominant cause of the multi-second
  // context_hydration tail on prod), and hydration runs on every run —
  // including cache hits, since the volatile fields are re-resolved.
  const entries = await Promise.all(
    input.envVars.map(async (envVar) => {
      if (envVar.secretId === null) {
        throw new Error(`Environment variable ${envVar.key} is pending and has no secret value.`);
      }

      const value = await readEnvironmentVariableSecret(bindings, {
        environmentId: input.environmentId,
        envVarKey: envVar.key,
        purpose: "runtime_snapshot_hydration",
        secretId: envVar.secretId,
      });
      return [envVar.key, value] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export function serializeConfig(input: EnvironmentMutableConfig): {
  allowedHostsJson: string;
  envVarsJson: string;
  packagesJson: string;
} {
  return {
    allowedHostsJson: JSON.stringify(input.allowedHosts),
    envVarsJson: serializeEnvVars(input.envVars),
    packagesJson: JSON.stringify(input.packages),
  };
}

export function makePackageSetupScript(packages: EnvironmentPackageSpec[]): string {
  const commands: string[] = [];
  const byManager = new Map<EnvironmentPackageManager, string[]>();

  for (const entry of packages) {
    byManager.set(entry.manager, [...(byManager.get(entry.manager) ?? []), ...entry.packages]);
  }

  for (const manager of PACKAGE_MANAGERS) {
    const specs = byManager.get(manager) ?? [];

    if (specs.length === 0) {
      continue;
    }

    const quoted = specs.map((spec) => `'${spec.replaceAll("'", String.raw`'\''`)}'`).join(" ");

    if (manager === "apt") {
      commands.push(`apt-get update && apt-get install -y ${quoted}`);
    } else if (manager === "cargo") {
      commands.push(`cargo install ${quoted}`);
    } else if (manager === "gem") {
      commands.push(`gem install ${quoted}`);
    } else if (manager === "go") {
      commands.push(`go install ${quoted}`);
    } else if (manager === "npm") {
      commands.push(`npm install -g ${quoted}`);
    } else {
      commands.push(`pip install ${quoted}`);
    }
  }

  return commands.join("\n");
}
