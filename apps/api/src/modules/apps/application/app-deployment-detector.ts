import type { AppDeploymentTargetKind } from "@mosoo/db";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml, stringify } from "smol-toml";

export type AppDeploymentPackageManager = "bun" | "none" | "npm" | "pnpm" | "yarn";
export type AppDeploymentTargetMode = "static_assets" | "worker_module" | "worker_with_assets";
export type AppDeploymentDetectionErrorCode =
  | "deployment_config_required"
  | "deployment_shape_unsupported";

export interface AppDeploymentPlan {
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
}

export interface AppDeploymentRepositorySnapshot {
  files: Readonly<Record<string, string>>;
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
  buildCommand: string | null;
  installCommand: string | null;
  outputDir: string | null;
  routesFallback: string | null;
  rootDir: string;
  workerEntry: string | null;
  type: "static" | "worker";
}

interface RepositoryFiles {
  has(path: string): boolean;
  read(path: string): string | null;
}

const COMPATIBILITY_DATE = "2026-06-26";
const GENERATED_RESOURCE_NAME = "mosoo-app";

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
): AppDeploymentPlan {
  const files = createRepositoryFiles(snapshot.files);
  const mosooConfig = files.read(".mosoo.toml");

  if (mosooConfig !== null) {
    return detectFromMosooConfig(files, mosooConfig);
  }

  return detectFromRepository(files, ".");
}

function detectFromMosooConfig(files: RepositoryFiles, source: string): AppDeploymentPlan {
  const config = parseMosooConfig(source);
  const packageJson = readPackageJson(files, config.rootDir);
  const packageManager = detectPackageManager(files, config.rootDir, packageJson);
  const installCommand =
    config.installCommand ?? installCommandFor(packageManager, files, config.rootDir);
  const buildCommand = config.buildCommand ?? buildCommandFor(packageManager, packageJson);

  if (config.type === "static") {
    const outputDir =
      config.outputDir ??
      fail("deployment_config_required", "static deployment requires build.output");

    return pagesPlan({
      buildCommand,
      installCommand,
      mosooConfigPath: ".mosoo.toml",
      outputDir,
      packageManager,
      routesFallback: config.routesFallback,
      rootDir: config.rootDir,
    });
  }

  const workerEntry =
    config.workerEntry ??
    fail("deployment_config_required", "worker deployment requires worker.entry");

  if (config.routesFallback !== null) {
    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "routes.fallback is only supported for static deployment",
    );
  }

  return workerPlan({
    buildCommand,
    installCommand,
    mosooConfigPath: ".mosoo.toml",
    packageManager,
    rootDir: config.rootDir,
    workerEntry,
  });
}

function detectFromRepository(files: RepositoryFiles, rootDir: string): AppDeploymentPlan {
  const packageJson = readPackageJson(files, rootDir);
  const packageManager = detectPackageManager(files, rootDir, packageJson);
  const wranglerMain = readWranglerMain(files, rootDir);

  if (wranglerMain !== null) {
    return workerPlan({
      buildCommand: buildCommandFor(packageManager, packageJson),
      installCommand: installCommandFor(packageManager, files, rootDir),
      mosooConfigPath: null,
      packageManager,
      rootDir,
      workerEntry: wranglerMain,
    });
  }

  if (packageJson === null) {
    if (files.has("index.html")) {
      return pagesPlan({
        buildCommand: null,
        installCommand: null,
        mosooConfigPath: null,
        outputDir: ".",
        packageManager: "none",
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
    return packagePagesPlan(files, rootDir, packageJson, packageManager, "dist");
  }

  if (hasDependency(packageJson, "astro")) {
    return packagePagesPlan(files, rootDir, packageJson, packageManager, "dist");
  }

  if (hasDependency(packageJson, "@docusaurus/core")) {
    return packagePagesPlan(files, rootDir, packageJson, packageManager, "build");
  }

  if (hasDependency(packageJson, "next")) {
    if (isNextStaticExport(files, rootDir, packageJson)) {
      return packagePagesPlan(files, rootDir, packageJson, packageManager, "out");
    }

    throw new AppDeploymentDetectionError(
      "deployment_config_required",
      "Next.js deployment requires explicit static export",
    );
  }

  if (files.has(pathInRoot(rootDir, "index.html")) && packageJson.scripts["build"] === undefined) {
    return pagesPlan({
      buildCommand: null,
      installCommand: null,
      mosooConfigPath: null,
      outputDir: ".",
      packageManager: "none",
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
): AppDeploymentPlan {
  const buildCommand =
    buildCommandFor(packageManager, packageJson) ??
    fail("deployment_config_required", "static framework deployment requires scripts.build");

  return pagesPlan({
    buildCommand,
    installCommand: installCommandFor(packageManager, files, rootDir),
    mosooConfigPath: null,
    outputDir,
    packageManager,
    routesFallback: null,
    rootDir,
  });
}

function pagesPlan(input: {
  buildCommand: string | null;
  installCommand: string | null;
  mosooConfigPath: ".mosoo.toml" | null;
  outputDir: string;
  packageManager: AppDeploymentPackageManager;
  routesFallback: string | null;
  rootDir: string;
}): AppDeploymentPlan {
  return {
    buildCommand: input.buildCommand,
    generatedWranglerConfig: stringify({
      compatibility_date: COMPATIBILITY_DATE,
      name: GENERATED_RESOURCE_NAME,
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
  };
}

function workerPlan(input: {
  buildCommand: string | null;
  installCommand: string | null;
  mosooConfigPath: ".mosoo.toml" | null;
  packageManager: AppDeploymentPackageManager;
  rootDir: string;
  workerEntry: string;
}): AppDeploymentPlan {
  return {
    buildCommand: input.buildCommand,
    generatedWranglerConfig: stringify({
      compatibility_date: COMPATIBILITY_DATE,
      main: input.workerEntry,
      name: GENERATED_RESOURCE_NAME,
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
  requireAllowedKeys(value, ["build", "name", "root", "routes", "type", "worker"], ".mosoo.toml");

  const type = readRequiredString(value, "type", ".mosoo.toml");

  if (type !== "static" && type !== "worker") {
    throw new AppDeploymentDetectionError(
      "deployment_shape_unsupported",
      ".mosoo.toml type must be static or worker",
    );
  }

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
  };
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

function readWranglerMain(files: RepositoryFiles, rootDir: string): string | null {
  const toml = files.read(pathInRoot(rootDir, "wrangler.toml"));

  if (toml !== null) {
    const main = readWranglerConfigMain(() => {
      const value = parseTomlObject(toml, pathInRoot(rootDir, "wrangler.toml"));

      return normalizeOptionalRelativePath(
        readOptionalString(value, "main", "wrangler.toml"),
        "main",
      );
    });

    if (main !== null) return main;
  }

  for (const file of ["wrangler.json", "wrangler.jsonc"]) {
    const path = pathInRoot(rootDir, file);
    const content = files.read(path);

    if (content !== null) {
      const main = readWranglerConfigMain(() => {
        const value = parseJsonObject(content, path);

        return normalizeOptionalRelativePath(readOptionalString(value, "main", path), "main");
      });

      if (main !== null) return main;
    }
  }

  return null;
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
