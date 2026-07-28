import { describe, expect, test } from "bun:test";

import { createWorkerModuleUpload } from "../src/modules/apps/application/app-deployment-cloudflare-client";

describe("app deployment Cloudflare client", () => {
  test("encodes Worker metadata as one JSON multipart field", () => {
    const upload = createWorkerModuleUpload({
      compatibilityDate: "2026-07-14",
      mainModuleName: "worker.js",
      scriptContent: "export default { fetch() {} };",
      scriptName: "example",
      vars: { MOSOO_AGENT_URL: "https://example.com/bound/token" },
    });

    expect(upload.files[0]?.name).toBe("worker.js");
    expect(upload.metadata).toBe(
      JSON.stringify({
        bindings: [
          {
            name: "MOSOO_AGENT_URL",
            text: "https://example.com/bound/token",
            type: "plain_text",
          },
        ],
        compatibility_date: "2026-07-14",
        main_module: "worker.js",
      }),
    );
  });
});
