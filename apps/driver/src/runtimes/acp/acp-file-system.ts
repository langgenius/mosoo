import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { DriverEventInput } from "@mosoo/driver-protocol";

import type { AgentDriverContext } from "../agent-driver-backend";
import { isRecord, readNonEmptyString, readNumber } from "./acp-types";

interface AcpFileSystemOptions {
  readonly allowedRoots: readonly string[];
  readonly cwd: string;
  push(context: AgentDriverContext, reason: string, events: DriverEventInput[]): Promise<void>;
}

export class AcpFileSystem {
  readonly #allowedRoots: readonly string[];
  readonly #cwd: string;
  readonly #push: AcpFileSystemOptions["push"];

  constructor(options: AcpFileSystemOptions) {
    this.#allowedRoots = [options.cwd, ...options.allowedRoots].map((root) =>
      resolve(options.cwd, root),
    );
    this.#cwd = resolve(options.cwd);
    this.#push = options.push;
  }

  async readTextFile(params: unknown): Promise<{ content: string }> {
    const record = isRecord(params) ? params : {};
    const requestedPath = readNonEmptyString(record, "path");

    if (requestedPath === null) {
      throw new Error("ACP fs/read_text_file requires a path.");
    }

    const path = this.#resolveAllowedPath(requestedPath);
    const raw = await readFile(path, "utf8");
    const line = readNumber(record, "line");
    const limit = readNumber(record, "limit");

    if (line === null && limit === null) {
      return { content: raw };
    }

    const lines = raw.split("\n");
    const startIndex = line === null ? 0 : Math.max(0, Math.floor(line) - 1);
    const endIndex = limit === null ? undefined : startIndex + Math.max(0, Math.floor(limit));

    return {
      content: lines.slice(startIndex, endIndex).join("\n"),
    };
  }

  async writeTextFile(
    context: AgentDriverContext,
    params: unknown,
  ): Promise<Record<string, never>> {
    const record = isRecord(params) ? params : {};
    const requestedPath = readNonEmptyString(record, "path");
    const content = typeof record["content"] === "string" ? record["content"] : null;

    if (requestedPath === null || content === null) {
      throw new Error("ACP fs/write_text_file requires path and content.");
    }

    const path = this.#resolveAllowedPath(requestedPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    await this.#push(context, "driver.acp.fs.write", [
      {
        kind: "file.changed",
        payload: {
          change: "upsert",
          path,
          source: "acp.fs",
        },
      },
    ]);

    return {};
  }

  #resolveAllowedPath(path: string): string {
    if (!isAbsolute(path)) {
      throw new Error(`ACP file path must be absolute: ${path}.`);
    }

    const resolvedPath = resolve(this.#cwd, path);

    if (
      this.#allowedRoots.some(
        (root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`),
      )
    ) {
      return resolvedPath;
    }

    throw new Error(`ACP file path is outside the allowed roots: ${path}.`);
  }
}
