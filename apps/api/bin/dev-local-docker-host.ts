import { existsSync } from "node:fs";

const MAC_DOCKER_ENGINES = [
  { name: "OrbStack", socket: ".orbstack/run/docker.sock" },
  { name: "Docker Desktop", socket: ".docker/run/docker.sock" },
] as const;

export interface LocalDockerHost {
  host: string;
  name: (typeof MAC_DOCKER_ENGINES)[number]["name"];
}

export function resolveMacDockerHost(
  platform: NodeJS.Platform,
  home: string | undefined,
  pathExists: (path: string) => boolean = existsSync,
): LocalDockerHost | null {
  const root = home?.trim();

  if (platform !== "darwin" || root === undefined || root.length === 0) {
    return null;
  }

  for (const engine of MAC_DOCKER_ENGINES) {
    const socketPath = `${root}/${engine.socket}`;

    if (pathExists(socketPath)) {
      return { host: `unix://${socketPath}`, name: engine.name };
    }
  }

  return null;
}
