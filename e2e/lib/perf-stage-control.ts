export interface ContainerApplicationRecord {
  readonly id: string;
  readonly image: string;
  readonly name: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ContainerApplicationInfoRecord {
  readonly activeRolloutId: string | null;
  readonly diskMb: number;
  readonly id: string;
  readonly maxInstances: number;
  readonly memoryMib: number;
  readonly schedulingInstances: number;
  readonly startingInstances: number;
  readonly updatedAt: string;
  readonly vcpu: number;
  readonly version: number;
}

export interface ExpectedContainerConfiguration {
  readonly diskMb?: number;
  readonly maxInstances?: number;
  readonly memoryMib?: number;
  readonly vcpu?: number;
}

export function disableWranglerRetainedVars(toml: string): string {
  const declarations = toml.match(/^keep_vars\s*=.*$/gmu) ?? [];
  if (declarations.length !== 1) {
    throw new Error("Benchmark Wrangler template must declare keep_vars exactly once.");
  }
  return toml.replace(/^keep_vars\s*=.*$/mu, "keep_vars = false");
}

export function selectWranglerEnvironmentConfig(toml: string, environment: string): string {
  const selectedPrefix = `env.${environment}`;

  const selected = toml
    .split(/(?=^\[\[?)/mu)
    .filter((section) => {
      const name = /^\[\[?([^\]]+)\]\]?/u.exec(section)?.[1];
      return (
        name === undefined ||
        !name.startsWith("env.") ||
        name === selectedPrefix ||
        name.startsWith(`${selectedPrefix}.`)
      );
    })
    .join("");

  return `${selected.trimEnd()}\n`;
}

export function containerResourceFingerprint(input: {
  readonly diskMb: number;
  readonly instanceType: string;
  readonly maxInstances: number;
  readonly memoryMib: number;
  readonly vcpu: number;
}): string {
  return [input.instanceType, input.vcpu, input.memoryMib, input.diskMb, input.maxInstances].join(
    "\0",
  );
}

export function overrideContainerDeploymentConfig(
  toml: string,
  input: {
    readonly environment: string;
    readonly instanceType: string;
    readonly maxInstances: number;
  },
): string {
  if (!/^[a-z0-9_-]+$/u.test(input.environment)) {
    throw new Error("Cloudflare performance environment name is invalid.");
  }
  if (!/^[a-z0-9-]+$/u.test(input.instanceType)) {
    throw new Error("Cloudflare container instance type is invalid.");
  }
  if (!Number.isSafeInteger(input.maxInstances) || input.maxInstances < 1) {
    throw new Error("Cloudflare container max instances must be a positive integer.");
  }

  const header = `[[env.${input.environment}.containers]]`;
  const headerIndex = toml.indexOf(header);
  if (headerIndex < 0 || toml.indexOf(header, headerIndex + header.length) >= 0) {
    throw new Error(`Wrangler config must contain exactly one ${header} block.`);
  }
  const bodyStart = headerIndex + header.length;
  const nextSectionOffset = toml.slice(bodyStart).search(/\n\[/u);
  const bodyEnd = nextSectionOffset < 0 ? toml.length : bodyStart + nextSectionOffset;
  const block = toml.slice(headerIndex, bodyEnd);
  const instanceMatches = block.match(/^instance_type\s*=.*$/gmu) ?? [];
  const maxMatches = block.match(/^max_instances\s*=.*$/gmu) ?? [];
  if (instanceMatches.length !== 1 || maxMatches.length !== 1) {
    throw new Error(`${header} must declare one instance_type and max_instances.`);
  }
  const updatedBlock = block
    .replace(/^instance_type\s*=.*$/mu, `instance_type = "${input.instanceType}"`)
    .replace(/^max_instances\s*=.*$/mu, `max_instances = ${input.maxInstances}`);
  return `${toml.slice(0, headerIndex)}${updatedBlock}${toml.slice(bodyEnd)}`;
}

export interface ContainerInstanceRecord {
  readonly appVersion: number | null;
  readonly createdAt: string | null;
  readonly deploymentId: string | null;
  readonly durableObjectId: string;
  readonly durableObjectName: string | null;
  readonly location: string | null;
  readonly state: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Cloudflare control-plane payload requires ${field}.`);
  }

  return value.trim();
}

function requiredNonNegativeNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Cloudflare container payload requires non-negative ${field}.`);
  }
  return value;
}

function requiredNonNegativeInteger(record: Record<string, unknown>, field: string): number {
  const value = requiredNonNegativeNumber(record, field);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Cloudflare container payload requires integer ${field}.`);
  }
  return value;
}

export function parseContainerApplications(value: unknown): ContainerApplicationRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Cloudflare container application list must be an array.");
  }

  return value.map((entry) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry["version"])) {
      throw new Error("Cloudflare container application record is invalid.");
    }

    return {
      id: requiredString(entry, "id"),
      image: requiredString(entry, "image"),
      name: requiredString(entry, "name"),
      state: requiredString(entry, "state"),
      updatedAt: requiredString(entry, "updated_at"),
      version: entry["version"] as number,
    };
  });
}

export function selectReadyContainerApplication(input: {
  readonly applications: readonly ContainerApplicationRecord[];
  readonly expectedDriverBundleSha256: string;
  readonly name: string;
  readonly observedDriverBundleSha256: string | null;
}): ContainerApplicationRecord | null {
  const application = input.applications.find((entry) => entry.name === input.name);

  return application?.state === "ready" &&
    input.observedDriverBundleSha256 === input.expectedDriverBundleSha256
    ? application
    : null;
}

export function parseContainerApplicationInfo(value: unknown): ContainerApplicationInfoRecord {
  if (!isRecord(value) || !isRecord(value["configuration"])) {
    throw new Error("Cloudflare container application info is invalid.");
  }

  const configuration = value["configuration"];
  const disk = isRecord(configuration["disk"]) ? configuration["disk"] : null;
  const health = isRecord(value["health"]) ? value["health"] : null;
  const instances = health !== null && isRecord(health["instances"]) ? health["instances"] : null;
  if (disk === null || instances === null) {
    throw new Error("Cloudflare container application info is missing disk or health.");
  }

  const activeRolloutId = value["active_rollout_id"];
  if (
    activeRolloutId !== undefined &&
    activeRolloutId !== null &&
    typeof activeRolloutId !== "string"
  ) {
    throw new Error("Cloudflare container application active rollout ID is invalid.");
  }

  return {
    activeRolloutId: typeof activeRolloutId === "string" ? activeRolloutId : null,
    diskMb: requiredNonNegativeInteger(disk, "size_mb"),
    id: requiredString(value, "id"),
    maxInstances: requiredNonNegativeInteger(value, "max_instances"),
    memoryMib: requiredNonNegativeInteger(configuration, "memory_mib"),
    schedulingInstances: requiredNonNegativeInteger(instances, "scheduling"),
    startingInstances: requiredNonNegativeInteger(instances, "starting"),
    updatedAt: requiredString(value, "updated_at"),
    vcpu: requiredNonNegativeNumber(configuration, "vcpu"),
    version: requiredNonNegativeInteger(value, "version"),
  };
}

export function isContainerApplicationRolloutReady(
  application: ContainerApplicationRecord,
  info: ContainerApplicationInfoRecord,
  expected: ExpectedContainerConfiguration,
): boolean {
  return (
    info.id === application.id &&
    info.version === application.version &&
    info.activeRolloutId === null &&
    info.schedulingInstances === 0 &&
    info.startingInstances === 0 &&
    (expected.diskMb === undefined || info.diskMb === expected.diskMb) &&
    (expected.maxInstances === undefined || info.maxInstances === expected.maxInstances) &&
    (expected.memoryMib === undefined || info.memoryMib === expected.memoryMib) &&
    (expected.vcpu === undefined || info.vcpu === expected.vcpu)
  );
}

function deriveInstanceState(instance: Record<string, unknown> | undefined): string {
  if (instance === undefined) {
    return "inactive";
  }

  const placement = instance["current_placement"];
  const status = isRecord(placement) ? placement["status"] : null;
  const raw = isRecord(status) ? (status["container_status"] ?? status["health"]) : null;
  return typeof raw === "string" && raw.length > 0 ? raw : "unknown";
}

export function parseContainerInstances(value: unknown): {
  readonly nextPageToken: string | null;
  readonly rows: ContainerInstanceRecord[];
} {
  if (!isRecord(value) || !isRecord(value["result"])) {
    throw new Error("Cloudflare container instance response is invalid.");
  }

  const result = value["result"];
  const instances = Array.isArray(result["instances"]) ? result["instances"] : [];
  const durableObjects = Array.isArray(result["durable_objects"]) ? result["durable_objects"] : [];
  const instanceById = new Map<string, Record<string, unknown>>();

  for (const instance of instances) {
    if (isRecord(instance) && typeof instance["id"] === "string") {
      instanceById.set(instance["id"], instance);
    }
  }

  const rows = durableObjects.map((durableObject): ContainerInstanceRecord => {
    if (!isRecord(durableObject)) {
      throw new Error("Cloudflare Durable Object instance record is invalid.");
    }

    const deploymentId =
      typeof durableObject["deployment_id"] === "string" ? durableObject["deployment_id"] : null;
    const instance = deploymentId === null ? undefined : instanceById.get(deploymentId);

    return {
      appVersion:
        instance !== undefined && Number.isSafeInteger(instance["app_version"])
          ? (instance["app_version"] as number)
          : null,
      createdAt:
        instance !== undefined && typeof instance["created_at"] === "string"
          ? instance["created_at"]
          : typeof durableObject["assigned_at"] === "string"
            ? durableObject["assigned_at"]
            : null,
      deploymentId,
      durableObjectId: requiredString(durableObject, "id").toLowerCase(),
      durableObjectName: typeof durableObject["name"] === "string" ? durableObject["name"] : null,
      location:
        instance !== undefined && typeof instance["location"] === "string"
          ? instance["location"]
          : null,
      state: deriveInstanceState(instance),
    };
  });
  const resultInfo = isRecord(value["result_info"]) ? value["result_info"] : null;

  return {
    nextPageToken:
      resultInfo !== null && typeof resultInfo["next_page_token"] === "string"
        ? resultInfo["next_page_token"]
        : null,
    rows,
  };
}

export function isContainerInactive(
  rows: readonly ContainerInstanceRecord[],
  durableObjectId: string,
): boolean {
  const row = rows.find((candidate) => candidate.durableObjectId === durableObjectId.toLowerCase());
  return row === undefined || row.state === "inactive";
}
