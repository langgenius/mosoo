import {
  DRIVER_BOOT_PAYLOAD_ENV_NAME,
  DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME,
} from "@mosoo/driver-protocol";

export { DRIVER_BOOT_PAYLOAD_ENV_NAME, DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME };

export function buildRuntimeChildProcessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    ...overrides,
  };

  delete env[DRIVER_BOOT_PAYLOAD_ENV_NAME];
  delete env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME];

  return env;
}
