import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import worker from "../src/worker";

test("routes the root asset through the Worker before serving it", () => {
  const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

  expect(wrangler).toContain('run_worker_first = ["/"]');
});

test("redirects the legacy console host without losing the path or query", async () => {
  let fetchedAsset = false;
  const response = await worker.fetch(
    new Request("http://try.mosoo.ai/apps/demo?source=bookmark"),
    {
      ASSETS: {
        fetch: () => {
          fetchedAsset = true;
          return Promise.resolve(new Response(null, { status: 404 }));
        },
      },
    },
  );

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://cloud.mosoo.ai/apps/demo?source=bookmark");
  expect(fetchedAsset).toBe(false);
});

test("redirects plaintext requests for the canonical console host", async () => {
  const response = await worker.fetch(new Request("http://cloud.mosoo.ai/settings?tab=profile"), {
    ASSETS: {
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    },
  });

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://cloud.mosoo.ai/settings?tab=profile");
});
