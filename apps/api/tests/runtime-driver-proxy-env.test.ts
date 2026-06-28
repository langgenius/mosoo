import { describe, expect, test } from "bun:test";

import { toRuntimeProcessProxyEnv } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-provisioning.service";

describe("runtime driver proxy env", () => {
  test("does not inject proxy env when runtime proxy bindings are absent", () => {
    expect(toRuntimeProcessProxyEnv({})).toEqual({});
  });

  test("injects uppercase and lowercase proxy env for runtime child processes", () => {
    expect(
      toRuntimeProcessProxyEnv({
        MOSOO_RUNTIME_ALL_PROXY: "http://host.docker.internal:1080",
        MOSOO_RUNTIME_HTTPS_PROXY: "http://host.docker.internal:1080",
        MOSOO_RUNTIME_NO_PROXY: "metadata.local",
      }),
    ).toEqual({
      ALL_PROXY: "http://host.docker.internal:1080",
      HTTPS_PROXY: "http://host.docker.internal:1080",
      NODE_USE_ENV_PROXY: "1",
      NO_PROXY: "metadata.local,localhost,127.0.0.1,::1,host.docker.internal",
      all_proxy: "http://host.docker.internal:1080",
      https_proxy: "http://host.docker.internal:1080",
      no_proxy: "metadata.local,localhost,127.0.0.1,::1,host.docker.internal",
    });
  });
});
