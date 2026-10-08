// Lists the Cloudflare container applications that wrangler creates for one
// environment. Monitoring resolves each expected name explicitly, so a renamed
// class or a truncated listing fails the check instead of silently going
// unwatched.

interface WranglerContainerConfig {
  readonly class_name: string;
  readonly name?: string;
}

interface WranglerEnvironmentConfig {
  readonly containers?: readonly WranglerContainerConfig[];
  readonly name?: string;
}

export interface WranglerConfig extends WranglerEnvironmentConfig {
  readonly env?: Readonly<Record<string, WranglerEnvironmentConfig>>;
}

export function containerApplicationNames(config: WranglerConfig, envName: string): string[] {
  const environment = config.env?.[envName];

  if (environment === undefined) {
    throw new Error(`wrangler config has no [env.${envName}] section.`);
  }

  const workerName = environment.name ?? config.name;

  if (workerName === undefined) {
    throw new Error(`wrangler config has no Worker name for env ${envName}.`);
  }

  // Mirrors wrangler's default application name: `${worker}-${class_name}-${env}`.
  return (environment.containers ?? []).map(
    (container) =>
      container.name ??
      `${workerName}-${container.class_name}-${envName}`.toLowerCase().replaceAll(" ", "-"),
  );
}

if (import.meta.main) {
  const [configPath, envName] = process.argv.slice(2);

  if (!configPath || !envName) {
    throw new Error("Usage: bun scripts/container-applications.ts <wrangler.toml> <env>");
  }

  const config = Bun.TOML.parse(await Bun.file(configPath).text()) as WranglerConfig;

  for (const name of containerApplicationNames(config, envName)) {
    console.log(name);
  }
}
