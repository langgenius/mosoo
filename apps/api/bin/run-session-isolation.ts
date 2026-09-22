import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { parsePlatformId } from "@mosoo/id";
import { getPlatformProxy } from "wrangler";

import type { SessionIsolationAdmin } from "../src/adapters/session-isolation-admin";

async function run(): Promise<void> {
  const [configPath, mode, input, outputDirectory, ...extra] = process.argv.slice(2);
  if (
    !configPath ||
    !mode ||
    !input ||
    !outputDirectory ||
    extra.length ||
    !isAbsolute(configPath) ||
    !isAbsolute(outputDirectory) ||
    !["prepare", "inspect", "advance", "run", "rollback"].includes(mode)
  ) {
    throw new Error(
      "Usage: just session-isolation-run <absolute operator config> <prepare|inspect|advance|run|rollback> <private request.json|operation ID> <absolute new receipt directory>",
    );
  }
  let request: unknown;
  if (mode === "prepare") {
    if (!isAbsolute(input)) throw new Error("Preparation requires an absolute private input path.");
    const stat = statSync(input);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 1_000_000) {
      throw new Error("Preparation input must be a private regular file of at most 1 MB.");
    }
    request = JSON.parse(readFileSync(input, "utf8"));
  } else {
    parsePlatformId(input, "isolation operation");
  }
  // Fail on an existing receipt directory before making any remote call.
  mkdirSync(outputDirectory, { mode: 0o700 });
  try {
    const result = await execute(configPath, mode, input, request);
    writeFileSync(join(outputDirectory, "receipt.json"), JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      `Session isolation ${result.phase}; private receipt saved. No model request was made.`,
    );
  } catch (error) {
    writeFileSync(
      join(outputDirectory, "failure.json"),
      JSON.stringify(
        {
          confirmed: false,
          error: error instanceof Error ? error.message : String(error),
          recovery:
            "Inspect and resume the same operation ID. Do not clear ownership or replace input.",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    throw error;
  }
}

async function execute(configPath: string, mode: string, input: string, request: unknown) {
  const proxy = await getPlatformProxy<{ SESSION_ISOLATION: Service<SessionIsolationAdmin> }>({
    configPath,
    persist: false,
    envFiles: [],
  });
  try {
    const service = proxy.env.SESSION_ISOLATION;
    if (!service) throw new Error("The reviewed operator config must bind SESSION_ISOLATION.");
    let result =
      mode === "prepare"
        ? await service.prepare(request)
        : mode === "rollback"
          ? await service.rollback(input)
          : mode === "advance"
            ? await service.advance(input)
            : await service.inspect(input);
    if (mode === "run" || mode === "rollback") {
      for (let step = 0; result.phase !== "complete" && step < 6; step++) {
        result = await service.advance(input);
      }
      if (result.phase !== "complete")
        throw new Error("Operation remains incomplete; inspect and resume the same ID.");
    }
    // Service results are proxy-backed. Detach the receipt before disposing
    // the transport so saving it cannot dereference an invalid RPC handle.
    return { operationId: result.operationId, phase: result.phase, direction: result.direction };
  } finally {
    await proxy.dispose();
  }
}

try {
  await run();
} catch {
  console.error(
    "Session isolation did not return a confirmed result. Inspect and resume the same operation ID; do not release claims or replace its input. See docs/session-isolation-transition.md.",
  );
  process.exitCode = 1;
}
