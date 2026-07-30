import { expect, test } from "bun:test";

import { createApiWorker } from "../src/platform/cloudflare/create-api-worker";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

test("redirects plaintext requests for both production API hosts", async () => {
  const fetch = createApiWorker().fetch;

  if (fetch === undefined || typeof fetch !== "function") {
    throw new Error("API Worker fetch handler is unavailable.");
  }

  for (const host of ["cloud.mosoo.ai", "try.mosoo.ai"]) {
    const response = await fetch(
      new Request(`http://${host}/api/health?source=https-check`),
      {} as ApiBindings,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://${host}/api/health?source=https-check`);
  }
});
