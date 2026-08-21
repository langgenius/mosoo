import type { AppDeploymentTargetKind } from "@mosoo/db";
import type { ParseError } from "jsonc-parser";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml, stringify } from "smol-toml";

export type AppDeploymentPackageManager = "bun" | "none" | "npm" | "pnpm" | "yarn";
export type AppDeploymentTargetMode = "static_assets" | "worker_module" | "worker_with_assets";
export type AppDeploymentDetectionErrorCode =
  | "deployment_config_required"
  | "deployment_shape_unsupported";

export interface AppDeploymentAgentBinding {
  env: string;
  expose: "public_thread";
  name: string;
}

export interface AppDeploymentPlan {
  agentBindings: AppDeploymentAgentBinding[];
  buildCommand: string | null;
  generatedWranglerConfig: string;
  installCommand: string | null;
  mosooConfigPath: ".mosoo.toml" | null;
  outputDir: string | null;
  packageManager: AppDeploymentPackageManager;
  routesFallback: string | null;
  rootDir: string;
  targetKind: AppDeploymentTargetKind;
  targetMode: AppDeploymentTargetMode;
  warnings: string[];
  workerEntry: string | null;
}

export interface AppDeploymentRepositorySnapshot {
  files: Readonly<Record<string, string>>;
}

export interface AppDeploymentDetectionOptions {
  resourceName: string;
}

interface PackageJson {
  dependencies: Readonly<Record<string, string>>;
  devDependencies: Readonly<Record<string, string>>;
  optionalDependencies: Readonly<Record<string, string>>;
  packageManager: string | null;
  peerDependencies: Readonly<Record<string, string>>;
  scripts: Readonly<Record<string, string>>;
}

interface MosooConfig {
  agents: AppDeploymentAgentBinding[];
  buildCommand: string | null;
  installCommand: string | null;
  outputDir: string | null;
  routesFallback: string | null;
  rootDir: string;
  workerEntry: string | null;
  wranglerConfigPath: string | null;
  type: "static" | "worker";
}

interface RepositoryFiles {
  has(path: string): boolean;
  read(path: string): string | null;
}

export const APP_DEPLOYMENT_COMPATIBILITY_DATE = "2026-06-26";
const WORKER_JS_ENTRY_PATTERN = /\.(?:mjs|js)$/u;

export class AppDeploymentDetectionError extends Error {
  readonly code: AppDeploymentDetectionErrorCode;

  constructor(code: AppDeploymentDetectionErrorCode, message: string) {
    super(message);
    this.name = "AppDeploymentDetectionError";
    this.code = code;
  }
}

export function detectAppDeploymentPlan(
  snapshot: AppDeploymentRepositorySnapshot,
  options: AppDeploymentDetectionOptions,
): AppDeploymentPlan {
  const files = createRepositoryFiles(snapshot.files);
  const mosooConfig = files.read(".mosoo.toml");
  const resourceName = normalizeResourceName(options.resourceName);

  if (mosooConfig !== null) {
    return detectFromMosooConfig(files, mosooConfig, resourceName);
  }

  return detectFromRepository(files, ".", resourceName);
}

function detectFromMosooConfig(
  files: RepositoryFiles,
  source: string,
  resourceName: string,
): AppDeploymentPlan {
  const config = parseMosooConfig(source);
  const packageJson = readPackageJson(files, config.rootDir);
  const packageManager = detectPackageManager(files, config.rootDir, packageJson);
  const installCommand =
    config.installCommand ?? installCommandFor(packageManager, files, config.rootDir);
  const buildCommand = config.buildCommand ?? buildCommandFor(packageManager, packageJson);

  if (config.type === "static") {
    if (config.agents.length > 0) {
      throw new AppDeploymentDetectionError(
        "deployment_shape_unsupported",
        "agent bindings ([[agents]]) require a worker deployment",
      );
    }

    const outputDir =
      config.outputDir ??
      fail("deployment_config_required", "static deployment requires build.output");

    return pagesPlan({
      agentBindings: config.agents,
      buildCommand,
      installCommand,
      mosooConfigPath: ".mosoo.toml",
      outputDir,
      packageManager,
      resourceName,
      routesFallback: config.routesFallback,
      rootDir: config.rootDir,
    });
  }

  const workerEntry =
    config.workerEntry ??
    readWranglerMain(files, config.rootDir, config.wranglerConfigPath) ??
    fail("deployment_config_required", "worker deployment requires worker.entry");

  if (config.routesFallback !== null) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "routes.fallback is only supported for static deployment",
    );
  }

  return workerPlan({
    agentBindings: config.agents,
    buildCommand,
    installCommand,
    mosooConfigPath: ".mosoo.toml",
    packageManager,
    resourceName,
    rootDir: config.rootDir,
    workerEntry,
  });
}

function detectFromRepository(
  files: RepositoryFiles,
  rootDir: string,
  resourceName: string,
): AppDeploymentPlan {
  const packageJson = readPackageJson(files, rootDir);
  const packageManager = detectPackageManager(files, rootDir, packageJson);
  const wranglerMain = readWranglerMain(files, rootDir);

  if (wranglerMain !== null) {
    return workerPlan({
      agentBindings: [],
      buildCommand: buildCommandFor(packageManager, packageJson),
      installCommand: installCommandFor(packageManager, files, rootDir),
      mosooConfigPath: null,
      packageManager,
      resourceName,
      rootDir,
      workerEntry: wranglerMain,
    });
  }

  if (packageJson === null) {
    if (files.has("index.html")) {
      return pagesPlan({
        agentBindings: [],
        buildCommand: null,
        installCommand: null,
        mosooConfigPath: null,
        outputDir: ".",
        packageManager: "none",
        resourceName,
        routesFallback: null,
        rootDir,
      });
    }

    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "repository does not match a supported deployment shape",
    );
  }

  if (hasDependency(packageJson, "vite")) {
    return packagePagesPlan(files, rootDir, packageJson, packageManager, "dist", resourceName);
  }

  if (hasDependency(packageJson, "astro")) {
    return packagePagesPlan(files, rootDir, packageJson, packageManager, "dist", resourceName);
  }

  if (hasDependency(packageJson, "@docusaurus/core")) {
    return packagePagesPlan(files, rootDir, packageJson, packageManager, "build", resourceName);
  }

  if (hasDependency(packageJson, "next")) {
    if (isNextStaticExport(files, rootDir, packageJson)) {
      return packagePagesPlan(files, rootDir, packageJson, packageManager, "out", resourceName);
    }

    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "Next.js deployment requires explicit static export",
    );
  }

  if (files.has(pathInRoot(rootDir, "index.html")) && packageJson.scripts["build"] === undefined) {
    return pagesPlan({
      agentBindings: [],
      buildCommand: null,
      installCommand: null,
      mosooConfigPath: null,
      outputDir: ".",
      packageManager: "none",
      resourceName,
      routesFallback: null,
      rootDir,
    });
  }

  throw new AppDeploymentDetectionError(
    "deployment_config_required",
    "repository does not match a supported deployment shape",
  );
}

function packagePagesPlan(
  files: RepositoryFiles,
  rootDir: string,
  packageJson: PackageJson,
  packageManager: AppDeploymentPackageManager,
  outputDir: string,
  resourceName: string,
): AppDeploymentPlan {
  const buildCommand =
    buildCommandFor(packageManager, packageJson) ??
    fail("deployment_config_required", "static framework deployment requires scripts.build");

  return pagesPlan({
    agentBindings: [],
    buildCommand,
    installCommand: installCommandFor(packageManager, files, rootDir),
    mosooConfigPath: null,
    outputDir,
    packageManager,
    resourceName,
    routesFallback: null,
    rootDir,
  });
}

function pagesPlan(input: {
  agentBindings: AppDeploymentAgentBinding[];
  buildCommand: string | null;
  installCommand: string | null;
  mosooConfigPath: ".mosoo.toml" | null;
  outputDir: string;
  packageManager: AppDeploymentPackageManager;
  resourceName: string;
  routesFallback: string | null;
  rootDir: string;
}): AppDeploymentPlan {
  return {
    agentBindings: input.agentBindings,
    buildCommand: input.buildCommand,
    generatedWranglerConfig: stringify({
      compatibility_date: APP_DEPLOYMENT_COMPATIBILITY_DATE,
      name: input.resourceName,
      pages_build_output_dir: input.outputDir,
    }),
    installCommand: input.installCommand,
    mosooConfigPath: input.mosooConfigPath,
    outputDir: input.outputDir,
    packageManager: input.packageManager,
    routesFallback: input.routesFallback,
    rootDir: input.rootDir,
    targetKind: "cloudflare_pages",
    targetMode: "static_assets",
    warnings: [],
    workerEntry: null,
  };
}

function workerPlan(input: {
  agentBindings: AppDeploymentAgentBinding[];
  buildCommand: string | null;
  installCommand: string | null;
  mosooConfigPath: ".mosoo.toml" | null;
  packageManager: AppDeploymentPackageManager;
  resourceName: string;
  rootDir: string;
  workerEntry: string;
}): AppDeploymentPlan {
  if (!WORKER_JS_ENTRY_PATTERN.test(input.workerEntry)) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "worker.entry must point to a JavaScript module file",
    );
  }

  return {
    agentBindings: input.agentBindings,
    buildCommand: input.buildCommand,
    generatedWranglerConfig: stringify({
      compatibility_date: APP_DEPLOYMENT_COMPATIBILITY_DATE,
      main: input.workerEntry,
      name: input.resourceName,
    }),
    installCommand: input.installCommand,
    mosooConfigPath: input.mosooConfigPath,
    outputDir: null,
    packageManager: input.packageManager,
    routesFallback: null,
    rootDir: input.rootDir,
    targetKind: "cloudflare_worker",
    targetMode: "worker_module",
    warnings: [],
    workerEntry: input.workerEntry,
  };
}

function createRepositoryFiles(files: Readonly<Record<string, string>>): RepositoryFiles {
  const normalized = new Map<string, string>();

  for (const [path, content] of Object.entries(files)) {
    normalized.set(normalizePath(path), content);
  }

  return {
    has(path) {
      return normalized.has(normalizePath(path));
    },
    read(path) {
      return normalized.get(normalizePath(path)) ?? null;
    },
  };
}

function parseMosooConfig(source: string): MosooConfig {
  const value = parseTomlObject(source, ".mosoo.toml");
  requireAllowedKeys(
    value,
    ["agents", "build", "deploy", "name", "root", "routes", "schema", "type", "worker"],
    ".mosoo.toml",
  );

  readSchemaVersion(value);

  const deploy = readTable(value, "deploy", ".mosoo.toml");
  requireAllowedKeys(deploy, ["adapter", "wrangler"], ".mosoo.toml deploy");
  const deployAdapter = value["deploy"] === undefined ? null : readDeployAdapter(deploy);
  const wranglerConfigPath = normalizeOptionalRelativePath(
    readOptionalString(deploy, "wrangler", ".mosoo.toml deploy"),
    "deploy.wrangler",
  );

  const type = resolveDeploymentType(
    readOptionalString(value, "type", ".mosoo.toml"),
    deployAdapter,
  );

  const build = readTable(value, "build", ".mosoo.toml");
  const worker = readTable(value, "worker", ".mosoo.toml");
  const routes = readTable(value, "routes", ".mosoo.toml");
  const routesFallback = normalizeOptionalRelativePath(
    readOptionalString(routes, "fallback", ".mosoo.toml routes"),
    "routes.fallback",
  );

  requireAllowedKeys(build, ["command", "install", "output"], ".mosoo.toml build");
  requireAllowedKeys(worker, ["entry"], ".mosoo.toml worker");
  requireAllowedKeys(routes, ["fallback"], ".mosoo.toml routes");
  readOptionalString(value, "name", ".mosoo.toml");

  return {
    agents: readAgentBindings(value),
    buildCommand: readOptionalString(build, "command", ".mosoo.toml build"),
    installCommand: readOptionalString(build, "install", ".mosoo.toml build"),
    outputDir: normalizeOptionalRelativePath(
      readOptionalString(build, "output", ".mosoo.toml build"),
      "build.output",
    ),
    rootDir: normalizeRelativePath(readOptionalString(value, "root", ".mosoo.toml") ?? ".", "root"),
    routesFallback,
    type,
    workerEntry: normalizeOptionalRelativePath(
      readOptionalString(worker, "entry", ".mosoo.toml worker"),
      "worker.entry",
    ),
    wranglerConfigPath,
  };
}

function readSchemaVersion(value: Readonly<Record<string, unknown>>): void {
  const schema = value["schema"];

  if (schema === undefined) {
    return;
  }

  if (typeof schema !== "number" || !Number.isInteger(schema)) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      ".mosoo.toml schema must be an integer",
    );
  }

  if (schema !== 1) {
    throw new AppDeploymentDetectionError(
      "deployment_shape_unsupported",
      ".mosoo.toml schema must be 1",
    );
  }
}

function readDeployAdapter(deploy: Readonly<Record<string, unknown>>): "cloudflare-workers" {
  const adapter = readRequiredString(deploy, "adapter", ".mosoo.toml deploy");

  if (adapter !== "cloudflare-workers") {
    throw new AppDeploymentDetectionError(
      "deployment_shape_unsupported",
      ".mosoo.toml deploy.adapter must be cloudflare-workers",
    );
  }

  return "cloudflare-workers";
}

function resolveDeploymentType(
  flatType: string | null,
  deployAdapter: "cloudflare-workers" | null,
): "static" | "worker" {
  if (flatType !== null) {
    if (flatType !== "static" && flatType !== "worker") {
      throw new AppDeploymentDetectionError(
        "deployment_shape_unsupported",
        ".mosoo.toml type must be static or worker",
      );
    }

    return flatType;
  }

  if (deployAdapter === "cloudflare-workers") {
    return "worker";
  }

  throw new AppDeploymentDetectionError(
    "deployment_config_required",
    ".mosoo.toml must declare type or [deploy].adapter",
  );
}

function readPackageJson(files: RepositoryFiles, rootDir: string): PackageJson | null {
  const path = pathInRoot(rootDir, "package.json");
  const content = files.read(path);

  if (content === null) {
    return null;
  }

  const value = parseJsonObject(content, path);

  return {
    dependencies: readStringRecord(value, "dependencies", path),
    devDependencies: readStringRecord(value, "devDependencies", path),
    optionalDependencies: readStringRecord(value, "optionalDependencies", path),
    packageManager: readOptionalString(value, "packageManager", path),
    peerDependencies: readStringRecord(value, "peerDependencies", path),
    scripts: readStringRecord(value, "scripts", path),
  };
}

function readWranglerMain(
  files: RepositoryFiles,
  rootDir: string,
  configPath: string | null = null,
): string | null {
  const candidates =
    configPath === null ? ["wrangler.toml", "wrangler.json", "wrangler.jsonc"] : [configPath];

  for (const file of candidates) {
    const main = readWranglerMainFromFile(files, pathInRoot(rootDir, file));

    if (main !== null) return main;
  }

  return null;
}

function readWranglerMainFromFile(files: RepositoryFiles, path: string): string | null {
  const content = files.read(path);

  if (content === null) {
    return null;
  }

  return readWranglerConfigMain(() => {
    const value = path.endsWith(".toml")
      ? parseTomlObject(content, path)
      : parseJsonObject(content, path);

    return normalizeOptionalRelativePath(readOptionalString(value, "main", path), "main");
  });
}

function readWranglerConfigMain(readMain: () => string | null): string | null {
  try {
    return readMain();
  } catch {
    return null;
  }
}

function detectPackageManager(
  files: RepositoryFiles,
  rootDir: string,
  packageJson: PackageJson | null,
): AppDeploymentPackageManager {
  if (files.has(pathInRoot(rootDir, "bun.lock")) || files.has(pathInRoot(rootDir, "bun.lockb"))) {
    return "bun";
  }

  if (files.has(pathInRoot(rootDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (files.has(pathInRoot(rootDir, "yarn.lock"))) {
    return "yarn";
  }

  if (
    files.has(pathInRoot(rootDir, "package-lock.json")) ||
    files.has(pathInRoot(rootDir, "npm-shrinkwrap.json"))
  ) {
    return "npm";
  }

  if (packageJson?.packageManager?.startsWith("bun@")) {
    return "bun";
  }

  if (packageJson?.packageManager?.startsWith("pnpm@")) {
    return "pnpm";
  }

  if (packageJson?.packageManager?.startsWith("yarn@")) {
    return "yarn";
  }

  if (packageJson !== null) {
    return "npm";
  }

  return "none";
}

function installCommandFor(
  packageManager: AppDeploymentPackageManager,
  files: RepositoryFiles,
  rootDir: string,
): string | null {
  switch (packageManager) {
    case "bun":
      return files.has(pathInRoot(rootDir, "bun.lock")) ||
        files.has(pathInRoot(rootDir, "bun.lockb"))
        ? "bun install --frozen-lockfile"
        : "bun install";
    case "npm":
      return files.has(pathInRoot(rootDir, "package-lock.json")) ? "npm ci" : "npm install";
    case "pnpm":
      return files.has(pathInRoot(rootDir, "pnpm-lock.yaml"))
        ? "pnpm install --frozen-lockfile"
        : "pnpm install";
    case "yarn":
      return files.has(pathInRoot(rootDir, "yarn.lock"))
        ? "yarn install --frozen-lockfile"
        : "yarn install";
    case "none":
      return null;
  }
}

function buildCommandFor(
  packageManager: AppDeploymentPackageManager,
  packageJson: PackageJson | null,
): string | null {
  if (packageJson?.scripts["build"] === undefined || packageManager === "none") {
    return null;
  }

  switch (packageManager) {
    case "bun":
      return "bun run build";
    case "npm":
      return "npm run build";
    case "pnpm":
      return "pnpm run build";
    case "yarn":
      return "yarn build";
  }
}

function isNextStaticExport(
  files: RepositoryFiles,
  rootDir: string,
  packageJson: PackageJson,
): boolean {
  const buildScript = packageJson.scripts["build"] ?? "";

  if (buildScript.includes("next export")) {
    return true;
  }

  for (const file of ["next.config.js", "next.config.mjs", "next.config.ts"]) {
    const content = files.read(pathInRoot(rootDir, file));

    if (content !== null && /\boutput\s*:\s*["'`]export["'`]/u.test(content)) {
      return true;
    }
  }

  return false;
}

function hasDependency(packageJson: PackageJson, name: string): boolean {
  return (
    packageJson.dependencies[name] !== undefined ||
    packageJson.devDependencies[name] !== undefined ||
    packageJson.optionalDependencies[name] !== undefined ||
    packageJson.peerDependencies[name] !== undefined
  );
}

function parseJsonObject(content: string, path: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  let value: unknown;

  try {
    if (path.endsWith(".jsonc")) {
      value = parseJsonc(content, errors, { allowTrailingComma: true });
    } else {
      value = JSON.parse(content);
    }
  } catch {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path} must be valid JSON`,
    );
  }

  if (errors.length > 0) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path} must be valid JSONC`,
    );
  }

  if (!isRecord(value)) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path} must be an object`,
    );
  }

  return value;
}

function parseTomlObject(content: string, path: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = parseToml(content);
  } catch {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path} must be valid TOML`,
    );
  }

  if (!isRecord(value)) {
    throw new AppDeploymentDetectionError("deployment_config_required", `${path} must be a table`);
  }

  return value;
}

function readStringRecord(
  source: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): Readonly<Record<string, string>> {
  const value = source[key];

  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path}.${key} must be an object`,
    );
  }

  const result: Record<string, string> = {};

  for (const [recordKey, recordValue] of Object.entries(value)) {
    if (typeof recordValue !== "string") {
      throw new AppDeploymentDetectionError(
        "deployment_config_required",
        `${path}.${key}.${recordKey} must be a string`,
      );
    }

    result[recordKey] = recordValue;
  }

  return result;
}

function readTable(
  source: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): Readonly<Record<string, unknown>> {
  const value = source[key];

  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path}.${key} must be a table`,
    );
  }

  return value;
}

function readTableArray(
  source: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): readonly Record<string, unknown>[] {
  const value = source[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path}.${key} must be an array of tables`,
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new AppDeploymentDetectionError(
        "deployment_config_required",
        `${path}.${key}[${index}] must be a table`,
      );
    }

    return entry;
  });
}

function readAgentBindings(value: Readonly<Record<string, unknown>>): AppDeploymentAgentBinding[] {
  const bindings = readTableArray(value, "agents", ".mosoo.toml").map(
    (entry, index): AppDeploymentAgentBinding => {
      const path = `.mosoo.toml agents[${index}]`;
      requireAllowedKeys(entry, ["env", "expose", "name"], path);

      if (readRequiredString(entry, "expose", path) !== "public_thread") {
        throw new AppDeploymentDetectionError(
          "deployment_shape_unsupported",
          `${path}.expose must be public_thread`,
        );
      }

      return {
        env: readRequiredString(entry, "env", path),
        expose: "public_thread",
        name: readRequiredString(entry, "name", path),
      };
    },
  );

  const seenNames = new Set<string>();
  const seenEnvs = new Set<string>();

  for (const binding of bindings) {
    if (seenNames.has(binding.name)) {
      throw new AppDeploymentDetectionError(
        "deployment_config_required",
        `.mosoo.toml agents.name "${binding.name}" is duplicated`,
      );
    }

    seenNames.add(binding.name);

    if (seenEnvs.has(binding.env)) {
      throw new AppDeploymentDetectionError(
        "deployment_config_required",
        `.mosoo.toml agents.env "${binding.env}" is duplicated`,
      );
    }

    seenEnvs.add(binding.env);
  }

  return bindings;
}

function readRequiredString(
  source: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): string {
  return (
    readOptionalString(source, key, path) ??
    fail("deployment_config_required", `${path}.${key} is required`)
  );
}

function readOptionalString(
  source: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): string | null {
  const value = source[key];

  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${path}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function requireAllowedKeys(
  source: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(source)) {
    if (!allowedKeys.includes(key)) {
      throw new AppDeploymentDetectionError(
        "deployment_config_required",
        `${path}.${key} is not supported`,
      );
    }
  }
}

function normalizeOptionalRelativePath(path: string | null, field: string): string | null {
  if (path === null) {
    return null;
  }

  return normalizeRelativePath(path, field);
}

function normalizeResourceName(value: string): string {
  const name = value.trim();

  if (name.length === 0) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "deployment resource name is required",
    );
  }

  return name;
}

function normalizeRelativePath(path: string, field: string): string {
  const rawPath = path.replaceAll("\\", "/");
  const parts = rawPath.split("/").filter((part) => part !== "" && part !== ".");

  if (rawPath.startsWith("/") || rawPath.includes("\0") || parts.includes("..")) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      `${field} must stay inside the repository`,
    );
  }

  return parts.length === 0 ? "." : parts.join("/");
}

function normalizePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

function pathInRoot(rootDir: string, path: string): string {
  return rootDir === "." ? path : `${rootDir}/${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: AppDeploymentDetectionErrorCode, message: string): never {
  throw new AppDeploymentDetectionError(code, message);
}
