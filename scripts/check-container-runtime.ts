interface ContainerInstance {
  // Each image class is its own Cloudflare application; the workflow tags rows
  // with the application they were listed from.
  readonly application?: string | null;
  readonly created: string | null;
  readonly id: string | null;
  readonly name?: string | null;
  readonly state: string;
}

export interface LongRunningContainer extends ContainerInstance {
  readonly ageHours: number;
}

const RUNNING_STATES = new Set(["provisioning", "running", "stopping", "unhealthy"]);

export function findActiveContainers(instances: readonly ContainerInstance[]): ContainerInstance[] {
  return instances.filter((instance) => RUNNING_STATES.has(instance.state));
}

export function countActiveContainersByApplication(
  instances: readonly ContainerInstance[],
): [application: string, count: number][] {
  const counts = new Map<string, number>();

  for (const instance of findActiveContainers(instances)) {
    const application = instance.application ?? "unknown";
    counts.set(application, (counts.get(application) ?? 0) + 1);
  }

  return [...counts].toSorted(([left], [right]) => left.localeCompare(right));
}

export function findLongRunningContainers(
  instances: readonly ContainerInstance[],
  now: number,
  thresholdHours: number,
): LongRunningContainer[] {
  const thresholdMs = thresholdHours * 60 * 60 * 1_000;

  return instances.flatMap((instance) => {
    if (!RUNNING_STATES.has(instance.state) || instance.created === null) {
      return [];
    }

    const createdAt = Date.parse(instance.created);
    const ageMs = now - createdAt;

    if (!Number.isFinite(createdAt) || ageMs < thresholdMs) {
      return [];
    }

    return [{ ...instance, ageHours: ageMs / 3_600_000 }];
  });
}

function readThresholdHours(raw: string | undefined): number {
  const thresholdHours = Number(raw ?? "2");

  if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
    throw new Error("Container runtime threshold must be a positive number of hours.");
  }

  return thresholdHours;
}

if (import.meta.main) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      "Usage: bun scripts/check-container-runtime.ts <instances.json> [hours] [active-count]",
    );
  }

  const thresholdHours = readThresholdHours(process.argv[3]);
  const activeContainerThreshold = Number(process.argv[4] ?? "10");
  if (!Number.isSafeInteger(activeContainerThreshold) || activeContainerThreshold <= 0) {
    throw new Error("Active container threshold must be a positive integer.");
  }

  const instances = (await Bun.file(inputPath).json()) as ContainerInstance[];
  const activeContainers = findActiveContainers(instances);
  const longRunning = findLongRunningContainers(instances, Date.now(), thresholdHours);

  if (activeContainers.length < activeContainerThreshold && longRunning.length === 0) {
    console.log(
      `${activeContainers.length} active container(s); none has run for ${thresholdHours} hours.`,
    );
    process.exit(0);
  }

  console.log(`# Container capacity alert\n`);
  console.log(
    `- Active containers: ${activeContainers.length} (alert threshold: ${activeContainerThreshold})`,
  );
  for (const [application, count] of countActiveContainersByApplication(instances)) {
    console.log(`  - \`${application}\`: ${count}`);
  }
  console.log(
    `- Long-running containers: ${longRunning.length} (alert threshold: ${thresholdHours} hours)\n`,
  );

  if (longRunning.length > 0) {
    console.log("| Application | Container | State | Age | Created (UTC) |");
    console.log("| --- | --- | --- | ---: | --- |");
    for (const instance of longRunning) {
      console.log(
        `| \`${instance.application ?? "unknown"}\` | \`${instance.name ?? instance.id ?? "unknown"}\` | ${instance.state} | ${instance.ageHours.toFixed(1)}h | ${instance.created} |`,
      );
    }
  }
  console.log(
    "\nInvestigate active Runs and stop any orphaned container before closing this issue. No container was stopped automatically.",
  );
  process.exit(2);
}
