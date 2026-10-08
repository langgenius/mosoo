import { beforeEach, describe, expect, mock, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { ProjectId } from "@mosoo/id";

import { ApiCommandPermanentError } from "../src/modules/api-command/application/api-command-payload";
import type { EnvironmentPackageArtifactBuildCommandPayload } from "../src/modules/api-command/application/api-command-payload";
import { normalizePackages } from "../src/modules/environments/application/environment-config";
import {
  createEnvironmentPackageArtifactKey,
  ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
  ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS,
} from "../src/modules/environments/domain/environment-package-artifact";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

interface ExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
  success: boolean;
}

const sandboxOptions: unknown[] = [];
let destroyed = 0;
let installResult: () => ExecResult;

mock.module("@cloudflare/sandbox", () => ({
  getSandbox(_namespace: unknown, _id: string, options: unknown) {
    sandboxOptions.push(options);
    return new Proxy(
      {},
      {
        get: (_, name) => {
          if (name === "then") return undefined;
          if (name === "destroy") {
            return async () => {
              destroyed += 1;
            };
          }
          if (name === "exec") {
            return async (command: string) =>
              command.startsWith("rm -rf")
                ? { exitCode: 0, stderr: "", stdout: "", success: true }
                : installResult();
          }
          return async () => undefined;
        },
      },
    );
  },
}));

const { buildEnvironmentPackageArtifact } =
  await import("../src/modules/environments/application/environment-package-artifact-build.service");

const PROJECT_ID = parsePlatformId<ProjectId>("01J0000000000000000000000A", "project id");

async function createPayload(): Promise<EnvironmentPackageArtifactBuildCommandPayload> {
  const packages = normalizePackages([{ manager: "npm", packages: ["zod@4.3.6"] }]);
  const key = await createEnvironmentPackageArtifactKey({
    artifactAbi: ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
    packages,
    projectId: PROJECT_ID,
  });

  return { ...key, artifactAbi: ENVIRONMENT_PACKAGE_ARTIFACT_ABI, packages };
}

function createBindings(): ApiBindings {
  return {
    SANDBOX_FILE_BUCKET_LOCAL: "true",
    SANDBOX_STATE_BUCKET: { get: async () => null },
    Sandbox: {},
  } as unknown as ApiBindings;
}

describe("environment package artifact build", () => {
  beforeEach(() => {
    sandboxOptions.length = 0;
    destroyed = 0;
  });

  test("lets an orphaned builder sleep instead of pinning it awake", async () => {
    installResult = () => ({
      exitCode: 1,
      stderr: "registry unavailable",
      stdout: "",
      success: false,
    });

    await expect(
      buildEnvironmentPackageArtifact(createBindings(), await createPayload()),
    ).rejects.toThrow("registry unavailable");
    expect(sandboxOptions).toEqual([{ keepAlive: false, normalizeId: true }]);
    expect(destroyed).toBe(1);
  });

  test("fails a timed-out install once with an actionable message", async () => {
    let now = 1_000;
    installResult = () => {
      now += ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS;
      return { exitCode: 137, stderr: "Killed", stdout: "", success: false };
    };

    const failure = await buildEnvironmentPackageArtifact(
      createBindings(),
      await createPayload(),
      () => now,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiCommandPermanentError);
    expect(failure).toMatchObject({
      code: "environment_package_build_timeout",
      message:
        "Package installation exceeded the 10-minute limit. Remove some packages, then save the Environment to retry.",
    });
    expect(destroyed).toBe(1);
  });

  test("keeps a fast install failure retryable", async () => {
    installResult = () => ({ exitCode: 1, stderr: "network reset", stdout: "", success: false });

    const failure = await buildEnvironmentPackageArtifact(
      createBindings(),
      await createPayload(),
      () => 1_000,
    ).catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(ApiCommandPermanentError);
    expect(failure).toMatchObject({ message: "network reset" });
  });
});
