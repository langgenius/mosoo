import { expect, test } from "bun:test";

import worker from "../src/worker";

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
