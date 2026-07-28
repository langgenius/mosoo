import { describe, expect, test } from "bun:test";

import { createWorkerModuleUpload } from "../src/modules/apps/application/app-deployment-cloudflare-client";

describe("app deployment Cloudflare client", () => {
  test("uses the module name and metadata as multipart part names", async () => {
    const scriptContent = "export default { fetch() {} };";
    const upload = createWorkerModuleUpload({
      compatibilityDate: "2026-07-14",
      mainModuleName: "worker.js",
      scriptContent,
      scriptName: "example",
      vars: { MOSOO_AGENT_URL: "https://example.com/bound/token" },
    });

    const modulePart = upload.get("worker.js");

    expect(upload).toBeInstanceOf(FormData);
    expect(modulePart).toBeInstanceOf(File);
    expect((modulePart as File).name).toBe("worker.js");
    expect((modulePart as File).type).toBe("application/javascript+module");
    expect(await (modulePart as File).text()).toBe(scriptContent);
    expect(upload.get("files")).toBeNull();
    expect(upload.get("metadata")).toBe(
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
