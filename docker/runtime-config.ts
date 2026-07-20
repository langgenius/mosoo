const REQUIRED_DEV_VAR_KEYS = [
  "BETTER_AUTH_SECRET",
  "RUNTIME_ACTION_TOKEN_SECRET",
  "VAULT_ROOT_SECRET",
] as const;

const OPTIONAL_DEV_VAR_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "SKILLS_SH_API_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "WECHAT_ILINK_BASE_URL",
] as const;

const MANAGED_DEV_VAR_KEYS = [...REQUIRED_DEV_VAR_KEYS, ...OPTIONAL_DEV_VAR_KEYS] as const;

export interface BuiltDevVars {
  readonly content: string;
  readonly generatedKeys: readonly string[];
}

function isLoopbackHost(value: string): boolean {
  const host = value
    .toLowerCase()
    .replace(/\.$/u, "")
    .replace(/^\[|\]$/gu, "");
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.startsWith("127.")
  );
}

export function validateWebExposure(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const bindAddress = environment.MOSOO_WEB_BIND_IP?.trim() || "127.0.0.1";
  const rawOrigin = environment.WEB_ORIGIN?.trim() || "http://localhost:8080";
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("WEB_ORIGIN must be an absolute http(s) URL.");
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("WEB_ORIGIN must be an absolute http(s) URL.");
  }
  if (isLoopbackHost(origin.hostname) && !isLoopbackHost(bindAddress)) {
    throw new Error(
      `WEB_ORIGIN=${rawOrigin} with MOSOO_WEB_BIND_IP=${bindAddress} would expose the development login backdoor. Use a public WEB_ORIGIN or bind the web listener to loopback.`,
    );
  }
}

function parseValue(rawValue: string, key: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "string") {
        throw new Error("not a string");
      }
      return parsed;
    } catch {
      throw new Error(`${key} has an invalid quoted value`);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function parseDevVars(content: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (match === null) {
      throw new Error(`Invalid Docker dev vars line: ${line}`);
    }

    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) {
      throw new Error(`Invalid Docker dev vars line: ${line}`);
    }
    if (values.has(key)) {
      throw new Error(`Duplicate Docker dev var: ${key}`);
    }

    values.set(key, parseValue(rawValue, key));
  }

  return values;
}

function assertSingleLine(key: string, value: string): void {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`${key} must not contain a newline`);
  }
}

export function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function buildDevVars(
  existingContent: string,
  environment: Readonly<Record<string, string | undefined>>,
  generateSecret: () => string = createSecret,
): BuiltDevVars {
  const values = parseDevVars(existingContent);
  const generatedKeys: string[] = [];

  for (const key of MANAGED_DEV_VAR_KEYS) {
    const override = environment[key];
    const required = REQUIRED_DEV_VAR_KEYS.includes(key as (typeof REQUIRED_DEV_VAR_KEYS)[number]);

    if (override !== undefined && (override.trim().length > 0 || !required)) {
      assertSingleLine(key, override);
      values.set(key, override);
      continue;
    }

    const existing = values.get(key) ?? "";
    assertSingleLine(key, existing);
    if (required) {
      if (existing.trim().length === 0) {
        const generated = generateSecret();
        assertSingleLine(key, generated);
        values.set(key, generated);
        generatedKeys.push(key);
      }
      continue;
    }

    if (!values.has(key)) {
      values.set(key, "");
    }
  }

  const content = `${[...values.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;

  return { content, generatedKeys };
}
