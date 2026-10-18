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

// Tells the workflow that Cloudflare cannot be read with the container-monitor
// credentials, which only a person can fix.
const CREDENTIALS_EXIT_CODE = 3;

const CREDENTIAL_NAMES = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

// With --json, wrangler 4.123.0 keeps only the Cloudflare API error message when
// the token is refused: code 10000 "Authentication error", code 9109
// unauthorized access, or a forbidden response.
const REFUSED_CREDENTIALS_PATTERN = /authentication error|unauthorized|forbidden/i;

export function missingCloudflareCredentials(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return CREDENTIAL_NAMES.filter((name) => (env[name] ?? "").trim() === "");
}

export function isRefusedCredentialsOutput(wranglerOutput: string): boolean {
  return REFUSED_CREDENTIALS_PATTERN.test(wranglerOutput);
}

export function credentialsMessage(problem: string): string {
  return `Container capacity is not monitored: ${problem}. Set CLOUDFLARE_API_TOKEN (a Containers Read token) and CLOUDFLARE_ACCOUNT_ID in GitHub Environment \`container-monitor\`; see the Credentials section of docs/production-deploy-verification.md#credentials.`;
}

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

function failCredentials(problem: string): never {
  console.log(credentialsMessage(problem));
  process.exit(CREDENTIALS_EXIT_CODE);
}

async function runBunxWranglerJson(args: readonly string[]): Promise<unknown> {
  const wrangler = process.env["WRANGLER"] ?? "wrangler";
  const child = Bun.spawn(["bunx", wrangler, ...args], { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  process.stderr.write(stderr);

  if (exitCode !== 0) {
    // With --json, wrangler prints API failures to stdout.
    process.stderr.write(stdout);
    if (isRefusedCredentialsOutput(`${stdout}\n${stderr}`)) {
      failCredentials("Cloudflare refused CLOUDFLARE_API_TOKEN for CLOUDFLARE_ACCOUNT_ID");
    }
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

  const missingCredentials = missingCloudflareCredentials(process.env);
  if (missingCredentials.length > 0) {
    failCredentials(`missing ${missingCredentials.join(" and ")}`);
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
