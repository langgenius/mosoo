interface ContainerInstance {
  readonly created: string | null;
  readonly id: string | null;
  readonly name?: string | null;
  readonly state: string;
}

export interface LongRunningContainer extends ContainerInstance {
  readonly ageHours: number;
}

const RUNNING_STATES = new Set(["provisioning", "running", "stopping", "unhealthy"]);

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
    throw new Error("Usage: bun scripts/check-container-runtime.ts <instances.json> [hours]");
  }

  const thresholdHours = readThresholdHours(process.argv[3]);
  const instances = (await Bun.file(inputPath).json()) as ContainerInstance[];
  const longRunning = findLongRunningContainers(instances, Date.now(), thresholdHours);

  if (longRunning.length === 0) {
    console.log(`No production container has run for ${thresholdHours} hours.`);
    process.exit(0);
  }

  console.log(`# Production container runtime alert\n`);
  console.log(
    `${longRunning.length} container(s) have run for at least ${thresholdHours} hours.\n`,
  );
  console.log("| Container | State | Age | Created (UTC) |");
  console.log("| --- | --- | ---: | --- |");
  for (const instance of longRunning) {
    console.log(
      `| \`${instance.name ?? instance.id ?? "unknown"}\` | ${instance.state} | ${instance.ageHours.toFixed(1)}h | ${instance.created} |`,
    );
  }
  console.log(
    "\nInvestigate active Runs and stop any orphaned container before closing this issue.",
  );
  process.exit(2);
}
