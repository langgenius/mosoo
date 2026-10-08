import { containerApplicationNames } from "./container-applications";
import type { WranglerConfig } from "./container-applications";

interface ContainerApplication {
  readonly id: string;
  readonly name: string;
}

interface ContainerInstancePage {
  readonly instances: readonly Record<string, unknown>[];
  readonly result_info: {
    readonly next_page_token: string | null;
  };
}

export type WranglerJsonRunner = (args: readonly string[]) => Promise<unknown>;

// wrangler's unpaginated --json output stops after the first 25 rows, which
// stopped Durable Objects can fill on their own; page explicitly instead.
const INSTANCE_PAGE_SIZE = "100";

export function resolveContainerApplications(
  expectedNames: readonly string[],
  applications: readonly ContainerApplication[],
): ContainerApplication[] {
  const missing = expectedNames.filter(
    (name) => !applications.some((application) => application.name === name),
  );

  if (missing.length > 0) {
    throw new Error(
      `Container applications missing from the Cloudflare listing: ${missing.join(", ")}.`,
    );
  }

  return expectedNames.flatMap((name) =>
    applications.filter((application) => application.name === name),
  );
}

export async function collectApplicationInstances(
  applications: readonly ContainerApplication[],
  runWranglerJson: WranglerJsonRunner,
): Promise<Record<string, unknown>[]> {
  const instances: Record<string, unknown>[] = [];

  for (const application of applications) {
    let pageToken: string | null = null;

    do {
      const page = (await runWranglerJson([
        "containers",
        "instances",
        application.id,
        "--json",
        "--per-page",
        INSTANCE_PAGE_SIZE,
        ...(pageToken === null ? [] : ["--page-token", pageToken]),
      ])) as ContainerInstancePage;

      instances.push(
        ...page.instances.map((instance) => ({ ...instance, application: application.name })),
      );
      pageToken = page.result_info.next_page_token;
    } while (pageToken !== null);
  }

  return instances;
}

async function runBunxWranglerJson(args: readonly string[]): Promise<unknown> {
  const wrangler = process.env["WRANGLER"] ?? "wrangler";
  const child = Bun.spawn(["bunx", wrangler, ...args], { stderr: "inherit", stdout: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  if (exitCode !== 0) {
    throw new Error(`wrangler ${args.join(" ")} exited with ${exitCode}.`);
  }

  return JSON.parse(stdout);
}

if (import.meta.main) {
  const [configPath, envName, outputPath] = process.argv.slice(2);

  if (!configPath || !envName || !outputPath) {
    throw new Error(
      "Usage: bun scripts/collect-container-instances.ts <wrangler.toml> <env> <instances.json>",
    );
  }

  const config = Bun.TOML.parse(await Bun.file(configPath).text()) as WranglerConfig;
  const applications = resolveContainerApplications(
    containerApplicationNames(config, envName),
    (await runBunxWranglerJson(["containers", "list", "--json"])) as ContainerApplication[],
  );

  await Bun.write(
    outputPath,
    JSON.stringify(await collectApplicationInstances(applications, runBunxWranglerJson)),
  );
}
