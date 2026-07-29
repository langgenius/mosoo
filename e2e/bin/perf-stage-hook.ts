import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  containerResourceFingerprint,
  disableWranglerRetainedVars,
  isContainerApplicationRolloutReady,
  overrideContainerDeploymentConfig,
  parseContainerApplicationInfo,
  parseContainerApplications,
  parseContainerInstances,
  selectReadyContainerApplication,
  selectWranglerEnvironmentConfig,
} from "../lib/perf-stage-control";
import type {
  ContainerApplicationInfoRecord,
  ContainerApplicationRecord,
  ContainerInstanceRecord,
  ExpectedContainerConfiguration,
} from "../lib/perf-stage-control";

const RESULT_PREFIX = "MOSOO_PERF_HOOK_RESULT=";
const CONTAINER_APPLICATION_READY_TIMEOUT_MS = 10 * 60 * 1_000;
const REMOTE_REQUEST_TIMEOUT_MS = 10_000;
const HARNESS_REVISION_VERSION = "mosoo.perf-harness.v1";
const NODE_FETCH_SCRIPT = `
const url = process.env.MOSOO_PERF_FETCH_URL;
const headers = JSON.parse(process.env.MOSOO_PERF_FETCH_HEADERS ?? "{}");
const timeoutMs = Number(process.env.MOSOO_PERF_FETCH_TIMEOUT_MS);
const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
const body = await response.text();
process.stdout.write(JSON.stringify({ body, status: response.status }));
`;

type Action = "cleanup" | "deploy" | "identity" | "trace";
type Variant = "after" | "before";
type Stack = "a" | "b";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";

  if (value.length === 0) {
    throw new Error(`Performance stage hook requires ${name}.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Performance stage hook input requires ${field}.`);
  }

  return value.trim();
}

function requireInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];

  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Performance stage hook input requires positive integer ${field}.`);
  }

  return value as number;
}

function readExpectedContainerNumber(
  variant: Variant,
  field: "DISK_MB" | "MAX_INSTANCES" | "MEMORY_MIB" | "VCPU",
): number | undefined {
  const name = `MOSOO_PERF_${variant.toUpperCase()}_CONTAINER_${field}`;
  const raw = process.env[name]?.trim() ?? "";
  if (raw.length === 0) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return value;
}

function readExpectedContainerConfiguration(variant: Variant): ExpectedContainerConfiguration {
  const diskMb = readExpectedContainerNumber(variant, "DISK_MB");
  const maxInstances = readExpectedContainerNumber(variant, "MAX_INSTANCES");
  const memoryMib = readExpectedContainerNumber(variant, "MEMORY_MIB");
  const vcpu = readExpectedContainerNumber(variant, "VCPU");
  return {
    ...(diskMb === undefined ? {} : { diskMb }),
    ...(maxInstances === undefined ? {} : { maxInstances }),
    ...(memoryMib === undefined ? {} : { memoryMib }),
    ...(vcpu === undefined ? {} : { vcpu }),
  };
}

function readContainerDeploymentConfiguration(variant: Variant): {
  readonly expected: Required<ExpectedContainerConfiguration>;
  readonly instanceType: string;
} {
  const expected = readExpectedContainerConfiguration(variant);
  const instanceType = requireEnv(`MOSOO_PERF_${variant.toUpperCase()}_CONTAINER_INSTANCE_TYPE`);
  const missing = (["diskMb", "maxInstances", "memoryMib", "vcpu"] as const).filter(
    (field) => expected[field] === undefined,
  );

  if (missing.length > 0) {
    throw new Error(
      `Container deployment ${variant} requires an exact expected configuration; missing ${missing.join(", ")}.`,
    );
  }

  return {
    expected: expected as Required<ExpectedContainerConfiguration>,
    instanceType,
  };
}

async function runCommand(input: {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
}): Promise<string> {
  const child = Bun.spawn([...input.args], {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `${basename(input.args[0] ?? "command")} exited ${exitCode}: ${stderr.trim().slice(-4_000)}`,
    );
  }

  return stdout;
}

async function fetchJsonWithHardTimeout(
  url: URL,
  headers: Record<string, string>,
): Promise<{ readonly payload: unknown; readonly status: number }> {
  const child = Bun.spawn(
    ["node", "--use-env-proxy", "--input-type=module", "--eval", NODE_FETCH_SCRIPT],
    {
      env: {
        ...process.env,
        MOSOO_PERF_FETCH_HEADERS: JSON.stringify(headers),
        MOSOO_PERF_FETCH_TIMEOUT_MS: String(REMOTE_REQUEST_TIMEOUT_MS),
        MOSOO_PERF_FETCH_URL: url.toString(),
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  let killed = false;
  const hardTimeout = setTimeout(() => {
    killed = true;
    child.kill();
  }, REMOTE_REQUEST_TIMEOUT_MS + 2_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(hardTimeout));

  if (killed) {
    throw new Error(`Remote request exceeded ${REMOTE_REQUEST_TIMEOUT_MS}ms.`);
  }
  if (exitCode !== 0) {
    throw new Error(`Remote request failed: ${stderr.trim().slice(-2_000)}`);
  }

  const envelope: unknown = JSON.parse(stdout);
  if (
    !isRecord(envelope) ||
    typeof envelope["body"] !== "string" ||
    typeof envelope["status"] !== "number" ||
    !Number.isSafeInteger(envelope["status"])
  ) {
    throw new Error("Remote request returned an invalid response envelope.");
  }

  return {
    payload: JSON.parse(envelope["body"] as string) as unknown,
    status: envelope["status"] as number,
  };
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function updateFramedHash(hash: ReturnType<typeof createHash>, label: string, content: Uint8Array) {
  hash.update(label).update("\0").update(String(content.byteLength)).update("\0").update(content);
}

async function computeHarnessRevision(): Promise<string> {
  const hash = createHash("sha256");
  const files = [
    ["cold-start-ab.ts", resolve(import.meta.dir, "cold-start-ab.ts")],
    ["perf-stage-hook.ts", resolve(import.meta.dir, "perf-stage-hook.ts")],
    ["env.ts", resolve(import.meta.dir, "../env.ts")],
    ["cold-start-benchmark.ts", resolve(import.meta.dir, "../lib/cold-start-benchmark.ts")],
    ["cold-start-experiment.ts", resolve(import.meta.dir, "../lib/cold-start-experiment.ts")],
    ["perf-stage-control.ts", resolve(import.meta.dir, "../lib/perf-stage-control.ts")],
  ] as const;

  updateFramedHash(hash, "version", Buffer.from(HARNESS_REVISION_VERSION));
  updateFramedHash(hash, "bun-revision", Buffer.from(Bun.revision));
  for (const [label, path] of files) {
    updateFramedHash(hash, label, await readFile(path));
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function hashWorkerRuntimeBundle(root: string): Promise<string> {
  const hash = createHash("sha256");
  let runtimeFileCount = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries.toSorted((left, right) => codeUnitCompare(left.name, right.name))) {
      const path = join(directory, entry.name);
      const relative = path.slice(root.length + 1);

      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && relative !== "README.md" && !relative.endsWith(".map")) {
        runtimeFileCount += 1;
        updateFramedHash(hash, relative, await readFile(path));
      }
    }
  }

  await visit(root);
  if (runtimeFileCount === 0) {
    throw new Error("Wrangler output did not contain a Worker runtime file.");
  }
  return hash.digest("hex");
}

const SOURCE_HASH_IGNORED_NAMES = new Set([
  ".git",
  ".tmp",
  ".turbo",
  ".vite",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

async function hashSourceTree(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries.toSorted((left, right) => codeUnitCompare(left.name, right.name))) {
      if (SOURCE_HASH_IGNORED_NAMES.has(entry.name)) {
        continue;
      }

      const path = join(directory, entry.name);
      const relative = path.slice(root.length + 1);
      hash.update(relative).update("\0");

      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        hash.update(await readFile(path)).update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(await readlink(path)).update("\0");
      }
    }
  }

  await visit(root);
  return hash.digest("hex");
}

export async function readSourceRevision(
  sourceRoot: string,
  sourceTreeSha256: string,
): Promise<string> {
  try {
    const head = (await runCommand({ args: ["git", "rev-parse", "HEAD"], cwd: sourceRoot })).trim();
    if (head.length > 0) {
      return `git:${head}:tree:${sourceTreeSha256}`;
    }
  } catch {
    // Frozen experiment roots deliberately omit .git. The measured source tree
    // digest remains the authoritative, content-addressed revision.
  }

  return `tree:${sourceTreeSha256}`;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

interface ImageMetrics {
  readonly gzipProxyBytes: number;
  readonly imageId: string;
  readonly uncompressedBytes: number;
}

async function countStreamBytes(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let total = 0;

  for (;;) {
    const chunk = await reader.read();

    if (chunk.done) {
      return total;
    }

    total += chunk.value.byteLength;
  }
}

async function measureImage(imageRef: string, imageDigest: string): Promise<ImageMetrics> {
  const cachePath = resolve(
    process.env["MOSOO_PERF_IMAGE_METRICS_CACHE"]?.trim() || ".tmp/perf/image-metrics.json",
  );
  let cache: Record<string, ImageMetrics> = {};

  try {
    cache = requireRecord(await readJson(cachePath), "Image metrics cache") as Record<
      string,
      ImageMetrics
    >;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const imageId = (
    await runCommand({
      args: ["docker", "image", "inspect", imageRef, "--format", "{{.Id}}"],
      cwd: process.cwd(),
    })
  ).trim();
  const cached = cache[imageDigest];

  if (cached?.imageId === imageId) {
    return cached;
  }

  const uncompressedBytes = Number(
    (
      await runCommand({
        args: ["docker", "image", "inspect", imageRef, "--format", "{{.Size}}"],
        cwd: process.cwd(),
      })
    ).trim(),
  );

  if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes <= 0) {
    throw new Error("Docker returned an invalid uncompressed image size.");
  }

  const save = Bun.spawn(["docker", "save", imageRef], { stderr: "pipe", stdout: "pipe" });
  const gzip = Bun.spawn(["gzip", "-1", "-c"], {
    stdin: save.stdout,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [saveExit, gzipExit, gzipProxyBytes, saveError, gzipError] = await Promise.all([
    save.exited,
    gzip.exited,
    countStreamBytes(gzip.stdout),
    new Response(save.stderr).text(),
    new Response(gzip.stderr).text(),
  ]);

  if (saveExit !== 0 || gzipExit !== 0) {
    throw new Error(`Docker image compression failed: ${saveError || gzipError}`);
  }

  const metrics = { gzipProxyBytes, imageId, uncompressedBytes };
  cache[imageDigest] = metrics;
  await atomicWriteJson(cachePath, cache);
  return metrics;
}

function parseDeploymentVersionId(value: unknown, deployedAfterMs: number): string {
  if (!Array.isArray(value)) {
    throw new Error("Wrangler deployment list must be an array.");
  }

  const candidates = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry["created_on"] !== "string") {
      return [];
    }

    const createdAt = Date.parse(entry["created_on"]);
    const versions = Array.isArray(entry["versions"]) ? entry["versions"] : [];
    const version = versions.find(
      (candidate) =>
        isRecord(candidate) &&
        candidate["percentage"] === 100 &&
        typeof candidate["version_id"] === "string",
    );

    return version !== undefined && createdAt >= deployedAfterMs - 60_000
      ? [{ createdAt, versionId: version["version_id"] as string }]
      : [];
  });
  const latest = candidates.toSorted((left, right) => right.createdAt - left.createdAt)[0];

  if (latest === undefined) {
    throw new Error("Wrangler did not confirm a new 100% Worker deployment.");
  }

  return latest.versionId;
}

async function waitForWorkerVersion(baseURL: string, workerVersionId: string): Promise<string> {
  const deadline = Date.now() + 180_000;
  const settleMs = 15_000;
  const requiredConsecutiveObservations = 5;
  let consecutiveObservations = 0;
  let firstStableObservationAt: number | null = null;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const healthURL = new URL("/api/health", `${baseURL}/`);
    healthURL.searchParams.set("perfDeployment", workerVersionId);
    healthURL.searchParams.set("observation", String(attempt));
    const response = await fetch(healthURL, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    }).catch(() => null);

    if (response?.ok && response.headers.get("x-mosoo-worker-version") === workerVersionId) {
      await response.body?.cancel().catch(() => {});
      firstStableObservationAt ??= Date.now();

      if (Date.now() - firstStableObservationAt >= settleMs) {
        consecutiveObservations += 1;

        if (consecutiveObservations >= requiredConsecutiveObservations) {
          return new Date().toISOString();
        }
      }
    } else {
      await response?.body?.cancel().catch(() => {});
      consecutiveObservations = 0;
      firstStableObservationAt = null;
    }
    await Bun.sleep(1_000);
  }

  throw new Error(`Worker ${workerVersionId} did not become stable within 180 seconds.`);
}

async function readContainerDriverBundleSha256(image: string): Promise<string | null> {
  try {
    const output = await runCommand({
      args: [
        "docker",
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--entrypoint",
        "sha256sum",
        image,
        "/usr/local/bin/agent-driver",
      ],
      cwd: process.cwd(),
    });
    const digest = /^([a-f0-9]{64})\s+/u.exec(output.trim())?.[1] ?? null;
    return digest;
  } catch {
    return null;
  }
}

async function waitForContainerApplication(input: {
  readonly apiRoot: string;
  readonly driverBundleSha256: string;
  readonly expectedConfiguration: ExpectedContainerConfiguration;
  readonly name: string;
}): Promise<{
  readonly application: ContainerApplicationRecord;
  readonly info: ContainerApplicationInfoRecord;
}> {
  const deadline = Date.now() + CONTAINER_APPLICATION_READY_TIMEOUT_MS;
  const driverHashes = new Map<string, string | null>();
  let stableSinceMs: number | null = null;
  let stableObservations = 0;
  let lastObserved = "missing";

  while (Date.now() < deadline) {
    let applications: ContainerApplicationRecord[];

    try {
      applications = parseContainerApplications(
        JSON.parse(
          await runCommand({
            args: ["bunx", "wrangler", "containers", "list", "--json"],
            cwd: input.apiRoot,
          }),
        ) as unknown,
      );
    } catch (error) {
      // Container rollouts are eventually consistent and the read-only control-plane
      // command can fail transiently while an application is provisioning. Readiness
      // is bounded by the deadline below, so retain the last error as evidence and
      // keep polling instead of discarding a balanced experiment block.
      lastObserved =
        error instanceof Error ? `control-plane read failed: ${error.message}` : String(error);
      await Bun.sleep(2_000);
      continue;
    }
    const application = applications.find((entry) => entry.name === input.name);
    let info: ContainerApplicationInfoRecord | null = null;
    if (application?.state === "ready") {
      try {
        info = parseContainerApplicationInfo(
          JSON.parse(
            await runCommand({
              args: ["bunx", "wrangler", "containers", "info", application.id],
              cwd: input.apiRoot,
            }),
          ) as unknown,
        );
      } catch (error) {
        lastObserved =
          error instanceof Error ? `container info read failed: ${error.message}` : String(error);
        await Bun.sleep(2_000);
        continue;
      }
    }
    const rolloutReady =
      application !== undefined &&
      info !== null &&
      isContainerApplicationRolloutReady(application, info, input.expectedConfiguration);
    let observedDriverBundleSha256: string | null = null;
    if (application !== undefined && rolloutReady) {
      if (!driverHashes.has(application.image)) {
        driverHashes.set(
          application.image,
          await readContainerDriverBundleSha256(application.image),
        );
      }
      observedDriverBundleSha256 = driverHashes.get(application.image) ?? null;
    }
    const ready = selectReadyContainerApplication({
      applications,
      expectedDriverBundleSha256: input.driverBundleSha256,
      name: input.name,
      observedDriverBundleSha256,
    });

    if (ready !== null && info !== null && rolloutReady) {
      stableSinceMs ??= Date.now();
      stableObservations += 1;
      if (Date.now() - stableSinceMs >= 10_000 && stableObservations >= 3) {
        return { application: ready, info };
      }
    } else {
      stableSinceMs = null;
      stableObservations = 0;
    }

    lastObserved =
      application === undefined
        ? "missing"
        : `version=${application.version} state=${application.state} image=${application.image} driver=${observedDriverBundleSha256 ?? "unavailable"} rollout=${info?.activeRolloutId ?? "none"} vcpu=${info?.vcpu ?? "unknown"} memoryMib=${info?.memoryMib ?? "unknown"} maxInstances=${info?.maxInstances ?? "unknown"} starting=${info?.startingInstances ?? "unknown"} scheduling=${info?.schedulingInstances ?? "unknown"}`;
    await Bun.sleep(2_000);
  }

  throw new Error(
    `Container application ${input.name} did not expose Driver ${input.driverBundleSha256} in ready state within ${CONTAINER_APPLICATION_READY_TIMEOUT_MS / 1_000} seconds; last=${lastObserved}.`,
  );
}

export function validateStackWranglerConfig(
  config: string,
  input: {
    readonly apiRoot: string;
    readonly baseURL: string;
    readonly databaseId: string;
    readonly environment: string;
    readonly resourcePrefix: string;
    readonly workerName: string;
  },
): void {
  const workerMain = /^main\s*=\s*"([^"]+)"$/mu.exec(config)?.[1];
  if (
    workerMain === undefined ||
    !resolve(input.apiRoot, workerMain).startsWith(`${resolve(input.apiRoot)}/`)
  ) {
    throw new Error(
      "Benchmark Wrangler template must use a relative main inside the treatment root.",
    );
  }
  const sections = [...config.matchAll(/^\[env\.([a-z0-9_-]+)\]$/gmu)];
  const sectionIndex = sections.findIndex((match) => match[1] === input.environment);
  const sectionMatch = sections[sectionIndex];
  if (sectionMatch?.index === undefined) {
    throw new Error(`Benchmark Wrangler template is missing [env.${input.environment}].`);
  }
  const nextSection = sections[sectionIndex + 1];
  const section = config.slice(sectionMatch.index, nextSection?.index ?? config.length);
  const expected = [
    `name = "${input.workerName}"`,
    `database_id = "${input.databaseId}"`,
    `WEB_ORIGIN = "${input.baseURL}"`,
    `QUEUE_NAME_PREFIX = "${input.resourcePrefix}"`,
    'image = "../driver/Dockerfile"',
  ];
  if (expected.some((entry) => !section.includes(entry))) {
    throw new Error(
      `Benchmark Wrangler template has mismatched ${input.environment} stack bindings.`,
    );
  }
  const resources = [...section.matchAll(/^(?:bucket_name|queue)\s*=\s*"([^"]+)"$/gmu)].map(
    (match) => match[1] ?? "",
  );
  if (resources.length === 0 || resources.some((name) => !name.startsWith(input.resourcePrefix))) {
    throw new Error(`Benchmark Wrangler template has cross-stack ${input.environment} resources.`);
  }
}

async function readStackWranglerConfig(apiRoot: string, environment: string): Promise<string> {
  const templatePath = resolve(requireEnv("MOSOO_PERF_WRANGLER_TEMPLATE"));
  const template = await readFile(templatePath, "utf8");
  const config = disableWranglerRetainedVars(template);
  validateStackWranglerConfig(config, {
    apiRoot,
    baseURL: requireEnv("MOSOO_PERF_BASE_URL").replace(/\/+$/u, ""),
    databaseId: requireEnv("MOSOO_PERF_D1_DATABASE_ID"),
    environment,
    resourcePrefix: requireEnv("MOSOO_PERF_RESOURCE_PREFIX"),
    workerName: requireEnv("MOSOO_PERF_WORKER_NAME"),
  });
  return config;
}

function normalizeStackWranglerConfig(config: string, environment: string): string {
  const resourceBase = requireEnv("MOSOO_PERF_RESOURCE_PREFIX").replace(/-+$/u, "");
  return selectWranglerEnvironmentConfig(config, environment)
    .replaceAll(`env.${environment}`, "env.<stack>")
    .replaceAll(requireEnv("MOSOO_PERF_WORKER_NAME"), "<worker>")
    .replaceAll(requireEnv("MOSOO_PERF_BASE_URL").replace(/\/+$/u, ""), "<base-url>")
    .replaceAll(requireEnv("MOSOO_PERF_D1_DATABASE_ID"), "<database-id>")
    .replaceAll(resourceBase, "<resource>")
    .replace(/^(MOSOO_APP_DEPLOYMENT_DOMAIN\s*=\s*)"[^"]*"$/gmu, '$1"<app-domain>"');
}

async function deploy(input: Record<string, unknown>) {
  const variant = requireString(input, "variant") as Variant;

  if (variant !== "before" && variant !== "after") {
    throw new Error("Deploy variant must be before or after.");
  }

  const ordinal = requireInteger(input, "ordinal");
  const phase = requireInteger(input, "phase");
  const stack = requireString(input, "stack") as Stack;
  if ((phase !== 1 && phase !== 2) || (stack !== "a" && stack !== "b")) {
    throw new Error("Deploy requires crossover phase 1/2 and stack a/b.");
  }
  const beforeConfiguration = readContainerDeploymentConfiguration("before");
  const afterConfiguration = readContainerDeploymentConfiguration("after");
  const fingerprint = (configuration: typeof beforeConfiguration) =>
    containerResourceFingerprint({
      ...configuration.expected,
      instanceType: configuration.instanceType,
    });
  if (fingerprint(beforeConfiguration) !== fingerprint(afterConfiguration)) {
    throw new Error("Before and after Container resources must be identical.");
  }
  const sourceRoot = resolve(
    variant === "before"
      ? requireEnv("MOSOO_PERF_BEFORE_ROOT")
      : requireEnv("MOSOO_PERF_AFTER_ROOT"),
  );
  const apiRoot = join(sourceRoot, "apps/api");
  const driverRoot = join(sourceRoot, "apps/driver");
  const environment = process.env["MOSOO_PERF_CF_ENV"]?.trim() || "perf_a";
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mosoo-perf-deploy-"));
  const temporaryWranglerConfig = join(
    apiRoot,
    `.wrangler-perf-${process.pid}-${variant}-${ordinal}.toml`,
  );

  try {
    const sourceTreeSha256BeforeBuild = await hashSourceTree(sourceRoot);
    // A frozen source tree can still carry a stale dist/driver.mjs. Rebuilding is
    // cheap relative to a Container rollout and is required for an isolated A/B:
    // the deployed artifact must be derived from that variant's source every time.
    await runCommand({ args: ["bun", "run", "build"], cwd: driverRoot });
    const sourceTreeSha256 = await hashSourceTree(sourceRoot);
    if (sourceTreeSha256 !== sourceTreeSha256BeforeBuild) {
      throw new Error("Driver build mutated the measured source tree.");
    }
    const driverBundleSha256 = await sha256File(join(driverRoot, "dist/driver.mjs"));
    const containerConfiguration = variant === "before" ? beforeConfiguration : afterConfiguration;
    const wranglerConfig = overrideContainerDeploymentConfig(
      await readStackWranglerConfig(apiRoot, environment),
      {
        environment,
        instanceType: containerConfiguration.instanceType,
        maxInstances: containerConfiguration.expected.maxInstances,
      },
    );
    const stackConfigSha256 = createHash("sha256").update(wranglerConfig).digest("hex");
    const treatmentConfigSha256 = createHash("sha256")
      .update(normalizeStackWranglerConfig(wranglerConfig, environment))
      .digest("hex");
    await writeFile(temporaryWranglerConfig, wranglerConfig, { mode: 0o600 });
    const deployedAfterMs = Date.now();
    const outputRoot = join(temporaryRoot, "worker");
    await mkdir(outputRoot, { recursive: true });
    await runCommand({
      args: [
        "bunx",
        "wrangler",
        "deploy",
        "--config",
        temporaryWranglerConfig,
        "--env",
        environment,
        "--containers-rollout",
        "immediate",
        "--tag",
        `perf-${variant}-${ordinal}`,
        "--message",
        `cold-start ${variant} deployment ${ordinal}`,
        "--outdir",
        outputRoot,
      ],
      cwd: apiRoot,
    });
    const deployments = JSON.parse(
      await runCommand({
        args: [
          "bunx",
          "wrangler",
          "deployments",
          "list",
          "--config",
          temporaryWranglerConfig,
          "--env",
          environment,
          "--json",
        ],
        cwd: apiRoot,
      }),
    ) as unknown;
    const workerVersionId = parseDeploymentVersionId(deployments, deployedAfterMs);
    const expectedApplicationName = requireEnv("MOSOO_PERF_CONTAINER_APPLICATION_NAME");
    const baseURL = requireEnv("MOSOO_PERF_BASE_URL").replace(/\/+$/u, "");
    const [{ application, info }] = await Promise.all([
      waitForContainerApplication({
        apiRoot,
        driverBundleSha256,
        expectedConfiguration: containerConfiguration.expected,
        name: expectedApplicationName,
      }),
      waitForWorkerVersion(baseURL, workerVersionId),
    ]);

    const imageDigest = application.image.includes("@")
      ? application.image.slice(application.image.lastIndexOf("@") + 1)
      : application.image;
    const imageMetrics = await measureImage(application.image, imageDigest);
    const workerBundleSha256 = await hashWorkerRuntimeBundle(outputRoot);
    await rm(temporaryWranglerConfig, { force: true });
    const sourceTreeSha256AfterDeploy = await hashSourceTree(sourceRoot);
    if (sourceTreeSha256AfterDeploy !== sourceTreeSha256) {
      throw new Error("Worker deployment mutated the measured source tree.");
    }
    const sourceRevision = await readSourceRevision(sourceRoot, sourceTreeSha256);
    const readyAt = new Date().toISOString();
    const physicalStackId = createHash("sha256")
      .update(requireEnv("MOSOO_PERF_WORKER_NAME"))
      .update("\0")
      .update(requireEnv("MOSOO_PERF_D1_DATABASE_ID"))
      .update("\0")
      .update(application.id)
      .update("\0")
      .update(baseURL)
      .digest("hex");

    return {
      containerApplicationId: application.id,
      containerApplicationVersion: String(application.version),
      containerDiskMb: info.diskMb,
      containerInstanceType: containerConfiguration.instanceType,
      containerMaxInstances: info.maxInstances,
      containerMemoryMib: info.memoryMib,
      containerVcpu: info.vcpu,
      deployedAt: new Date(deployedAfterMs).toISOString(),
      driverBundleSha256,
      imageDigest,
      imageGzipProxyBytes: imageMetrics.gzipProxyBytes,
      imageUncompressedBytes: imageMetrics.uncompressedBytes,
      ordinal,
      physicalStackId,
      phase,
      readyAt,
      sourceRevision,
      stack,
      stackConfigSha256,
      treatmentConfigSha256,
      variant,
      workerBundleSha256,
      workerVersionId,
    };
  } finally {
    await Promise.all([
      rm(temporaryRoot, { force: true, recursive: true }),
      rm(temporaryWranglerConfig, { force: true }),
    ]);
  }
}

async function fetchPerformanceEndpoint(
  path: string,
  query: Record<string, string>,
): Promise<Record<string, unknown>> {
  const baseURL = requireEnv("MOSOO_PERF_BASE_URL").replace(/\/+$/u, "");
  const url = new URL(path, `${baseURL}/`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchJsonWithHardTimeout(url, {
    "x-mosoo-perf-auth": requireEnv("MOSOO_PERF_AUTH_TOKEN"),
  });
  const payload = response.payload;

  if (response.status < 200 || response.status >= 300 || !isRecord(payload)) {
    const detail =
      isRecord(payload) && typeof payload["error"] === "string"
        ? `: ${payload["error"].slice(0, 2_000)}`
        : "";
    throw new Error(`Performance endpoint ${path} failed with HTTP ${response.status}${detail}.`);
  }

  return payload;
}

async function identity(input: Record<string, unknown>) {
  const observation = requireRecord(input["observation"], "Identity observation");
  const runId = requireString(observation, "runId");
  const threadId = requireString(observation, "threadId");
  const payload = await fetchPerformanceEndpoint("/v1/internal/performance/runtime-identity", {
    runId,
    threadId,
  });

  const checks = [
    { actual: requireString(payload, "runId"), expected: runId, field: "runId" },
    { actual: requireString(payload, "threadId"), expected: threadId, field: "threadId" },
  ];
  const mismatches = checks.filter((check) => check.actual !== check.expected);

  if (mismatches.length > 0) {
    throw new Error(
      `Live runtime identity mismatch: ${mismatches
        .map(
          (mismatch) => `${mismatch.field} expected=${mismatch.expected} actual=${mismatch.actual}`,
        )
        .join(", ")}`,
    );
  }

  return payload;
}

async function trace(input: Record<string, unknown>) {
  const observation = requireRecord(input["observation"], "Trace observation");

  return fetchPerformanceEndpoint("/v1/internal/performance/runtime-trace", {
    runId: requireString(observation, "runId"),
    threadId: requireString(observation, "threadId"),
  });
}

async function findContainerInstance(
  applicationId: string,
  durableObjectId: string,
): Promise<ContainerInstanceRecord | null> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  let pageToken: string | null = null;

  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/containers/dash/applications/${encodeURIComponent(applicationId)}/instances`,
    );
    url.searchParams.set("per_page", "100");

    if (pageToken !== null) {
      url.searchParams.set("page_token", pageToken);
    }

    const response = await fetchJsonWithHardTimeout(url, {
      Authorization: `Bearer ${token}`,
    });
    const payload = response.payload;

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Cloudflare container instances failed with HTTP ${response.status}.`);
    }

    const page = parseContainerInstances(payload);
    const matchingInstance = page.rows.find(
      (instance) => instance.durableObjectId === durableObjectId.toLowerCase(),
    );
    if (matchingInstance !== undefined) {
      return matchingInstance;
    }
    pageToken = page.nextPageToken;
  } while (pageToken !== null);

  return null;
}

async function cleanup(input: Record<string, unknown>) {
  const runIdentity = requireRecord(input["identity"], "Cleanup identity");
  const threadId = requireString(input, "threadId");
  const containerApplicationId = requireString(runIdentity, "containerApplicationId");
  const containerDurableObjectId = requireString(runIdentity, "containerDurableObjectId");
  const deadline = Date.now() + 180_000;
  let lastObserved = "no observation";

  while (Date.now() < deadline) {
    try {
      const [logical, matchingInstance] = await Promise.all([
        fetchPerformanceEndpoint("/v1/internal/performance/runtime-cleanup", {
          driverInstanceId: requireString(runIdentity, "driverInstanceId"),
          sandboxId: requireString(runIdentity, "sandboxId"),
          threadId,
        }),
        findContainerInstance(containerApplicationId, containerDurableObjectId),
      ]);
      const logicalGone =
        logical["driverDeleted"] === true &&
        logical["sandboxCold"] === true &&
        logical["sandboxSessionDeleted"] === true &&
        logical["sessionDeleted"] === true;
      const physicalGone = matchingInstance === null || matchingInstance.state === "inactive";
      lastObserved = JSON.stringify({
        logical: {
          driverDeleted: logical["driverDeleted"],
          sandboxCold: logical["sandboxCold"],
          sandboxSessionDeleted: logical["sandboxSessionDeleted"],
          sessionDeleted: logical["sessionDeleted"],
        },
        physical: matchingInstance
          ? {
              appVersion: matchingInstance.appVersion,
              location: matchingInstance.location,
              state: matchingInstance.state,
            }
          : { state: "absent" },
      });

      if (logicalGone && physicalGone) {
        return { containerGone: true, verifiedAt: new Date().toISOString() };
      }
    } catch (error) {
      lastObserved = JSON.stringify({
        requestError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }

    await Bun.sleep(2_000);
  }

  throw new Error(`Runtime cleanup was not confirmed within 180 seconds; last=${lastObserved}.`);
}

async function main(): Promise<void> {
  const action = process.argv[2] as Action | undefined;
  const input = requireRecord(JSON.parse(process.argv[3] ?? "null") as unknown, "Hook input");
  const expectedHarnessRevision = requireString(input, "harnessRevision");
  const actualHarnessRevision = await computeHarnessRevision();

  if (actualHarnessRevision !== expectedHarnessRevision) {
    throw new Error(
      `Performance harness changed during execution: expected=${expectedHarnessRevision} actual=${actualHarnessRevision}.`,
    );
  }

  if (action !== "deploy" && action !== "identity" && action !== "trace" && action !== "cleanup") {
    throw new Error("Performance stage hook action must be deploy, identity, trace, or cleanup.");
  }

  const result =
    action === "deploy"
      ? await deploy(input)
      : action === "identity"
        ? await identity(input)
        : action === "trace"
          ? await trace(input)
          : await cleanup(input);
  console.log(
    `${RESULT_PREFIX}${JSON.stringify({ ...result, harnessRevision: actualHarnessRevision })}`,
  );
}

if (import.meta.main) {
  await main();
}
