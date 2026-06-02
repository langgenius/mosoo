import { afterEach, describe, expect, test } from "bun:test";

import {
  DRIVER_BOOT_PAYLOAD_ENV_NAME,
  DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME,
  buildRuntimeChildProcessEnv,
} from "../src/runtimes/child-process-env";

const inheritedEnvName = "MOSOO_DRIVER_ENV_TEST_KEEP";
const inheritedEnvValue = process.env[inheritedEnvName];
const bootPayloadEnvValue = process.env[DRIVER_BOOT_PAYLOAD_ENV_NAME];
const bootPayloadFileEnvValue = process.env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME];

afterEach(() => {
  if (inheritedEnvValue === undefined) {
    delete process.env[inheritedEnvName];
  } else {
    process.env[inheritedEnvName] = inheritedEnvValue;
  }

  if (bootPayloadEnvValue === undefined) {
    delete process.env[DRIVER_BOOT_PAYLOAD_ENV_NAME];
  } else {
    process.env[DRIVER_BOOT_PAYLOAD_ENV_NAME] = bootPayloadEnvValue;
  }

  if (bootPayloadFileEnvValue === undefined) {
    delete process.env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME];
  } else {
    process.env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME] = bootPayloadFileEnvValue;
  }
});

describe("buildRuntimeChildProcessEnv", () => {
  test("keeps inherited environment and removes driver-only boot payload", () => {
    process.env[inheritedEnvName] = "keep";
    process.env[DRIVER_BOOT_PAYLOAD_ENV_NAME] = "large-private-payload";
    process.env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME] = "large-private-payload-file";

    const env = buildRuntimeChildProcessEnv({
      RUNTIME_VISIBLE_VAR: "visible",
    });

    expect(env[inheritedEnvName]).toBe("keep");
    expect(env["RUNTIME_VISIBLE_VAR"]).toBe("visible");
    expect(env[DRIVER_BOOT_PAYLOAD_ENV_NAME]).toBeUndefined();
    expect(env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME]).toBeUndefined();
  });

  test("does not allow overrides to reintroduce driver-only boot payload references", () => {
    const env = buildRuntimeChildProcessEnv({
      [DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME]: "override-payload-file",
      [DRIVER_BOOT_PAYLOAD_ENV_NAME]: "override",
    });

    expect(env[DRIVER_BOOT_PAYLOAD_ENV_NAME]).toBeUndefined();
    expect(env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME]).toBeUndefined();
  });
});
