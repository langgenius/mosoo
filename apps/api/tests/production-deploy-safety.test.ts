import { expect, test } from "bun:test";

test("switches the production Worker and Driver image without a gradual protocol split", async () => {
  const source = await Bun.file(new URL("../bin/deploy-prod.ts", import.meta.url)).text();

  expect(source).toContain(
    'run(["deploy", "--env", ENV, "--minify", "--containers-rollout", "immediate"]);',
  );
});
