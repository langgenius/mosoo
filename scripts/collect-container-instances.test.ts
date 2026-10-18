import { describe, expect, test } from "bun:test";

import {
  collectApplicationInstances,
  credentialsMessage,
  isRefusedCredentialsOutput,
  missingCloudflareCredentials,
  resolveContainerApplications,
} from "./collect-container-instances";

describe("collect container instances", () => {
  test("pages through every instance and tags its application", async () => {
    const calls: string[][] = [];
    const pages = new Map<string, unknown>([
      [
        "app-1:",
        {
          instances: [{ id: "i-1", state: "inactive" }],
          result_info: { next_page_token: "page-2" },
        },
      ],
      [
        "app-1:page-2",
        { instances: [{ id: "i-2", state: "running" }], result_info: { next_page_token: null } },
      ],
      [
        "app-2:",
        { instances: [{ id: "i-3", state: "running" }], result_info: { next_page_token: null } },
      ],
    ]);

    const instances = await collectApplicationInstances(
      [
        { id: "app-1", name: "worker-prod-sandbox-prod" },
        { id: "app-2", name: "worker-prod-sandboxpi-prod" },
      ],
      (args) => {
        calls.push([...args]);
        const tokenIndex = args.indexOf("--page-token");
        return Promise.resolve(
          pages.get(`${args[2]}:${tokenIndex === -1 ? "" : args[tokenIndex + 1]}`),
        );
      },
    );

    expect(instances).toEqual([
      { application: "worker-prod-sandbox-prod", id: "i-1", state: "inactive" },
      { application: "worker-prod-sandbox-prod", id: "i-2", state: "running" },
      { application: "worker-prod-sandboxpi-prod", id: "i-3", state: "running" },
    ]);
    expect(calls).toEqual([
      ["containers", "instances", "app-1", "--json", "--per-page", "100"],
      ["containers", "instances", "app-1", "--json", "--per-page", "100", "--page-token", "page-2"],
      ["containers", "instances", "app-2", "--json", "--per-page", "100"],
    ]);
  });

  test("resolves expected applications in configuration order", () => {
    const applications = [
      { id: "b", name: "worker-prod-sandbox-prod" },
      { id: "a", name: "worker-prod-sandboxpi-prod" },
      { id: "x", name: "unrelated-app" },
    ];

    expect(
      resolveContainerApplications(
        ["worker-prod-sandboxpi-prod", "worker-prod-sandbox-prod"],
        applications,
      ),
    ).toEqual([
      { id: "a", name: "worker-prod-sandboxpi-prod" },
      { id: "b", name: "worker-prod-sandbox-prod" },
    ]);
  });

  test("fails when an expected application is absent", () => {
    expect(() =>
      resolveContainerApplications(
        ["worker-prod-sandbox-prod", "worker-prod-sandboxpi-prod"],
        [{ id: "b", name: "worker-prod-sandbox-prod" }],
      ),
    ).toThrow(
      "Container applications missing from the Cloudflare listing: worker-prod-sandboxpi-prod.",
    );
  });
});

describe("container monitor credentials", () => {
  test("reports unset, empty and blank secrets in a fixed order", () => {
    expect(missingCloudflareCredentials({})).toEqual([
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ]);
    expect(
      missingCloudflareCredentials({ CLOUDFLARE_ACCOUNT_ID: " ", CLOUDFLARE_API_TOKEN: "" }),
    ).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(
      missingCloudflareCredentials({ CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "token" }),
    ).toEqual(["CLOUDFLARE_ACCOUNT_ID"]);
    expect(
      missingCloudflareCredentials({
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "token",
      }),
    ).toEqual([]);
  });

  test("names the environment, both secrets and an existing runbook section", async () => {
    expect(credentialsMessage("missing CLOUDFLARE_ACCOUNT_ID")).toBe(
      "Container capacity is not monitored: missing CLOUDFLARE_ACCOUNT_ID. Set CLOUDFLARE_API_TOKEN (a Containers Read token) and CLOUDFLARE_ACCOUNT_ID in GitHub Environment `container-monitor`; see the Credentials section of docs/production-deploy-verification.md#credentials.",
    );

    // The doc link check ignores #anchors, so pin the heading the message names.
    const runbook = await Bun.file(
      `${import.meta.dir}/../docs/production-deploy-verification.md`,
    ).text();
    expect(runbook).toContain("\n## Credentials\n");
  });

  test("recognizes how wrangler --json reports a refused token", () => {
    const outputs = [
      // HTTP 401/403 reaches stdout with only the API error message.
      String.raw`{"error":"There has been an unknown error listing containers.\n{\"error\":\"Authentication error\"}"}`,
      // HTTP 400/404 is a user error on stderr.
      "There has been an error fetching instances.\nUnauthorized to access requested resource\nUse `wrangler containers list` to view your containers and corresponding IDs.",
      String.raw`{"error":"There has been an unknown error fetching instances.\n{\"error\":\"Forbidden\"}"}`,
    ];

    for (const output of outputs) {
      expect(isRefusedCredentialsOutput(output)).toBe(true);
    }
  });

  test("leaves outages and other wrangler failures to fail the job", () => {
    const outputs = [
      String.raw`{"error":"There has been an internal error listing containers.\nfetch failed"}`,
      String.raw`{"error":"There has been an unknown error fetching instances.\n{\"error\":\"Internal Server Error\"}"}`,
    ];

    for (const output of outputs) {
      expect(isRefusedCredentialsOutput(output)).toBe(false);
    }
  });

  test("exits 3 with the fix before running wrangler when a secret is missing", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/collect-container-instances.ts`,
        "apps/api/wrangler.toml",
        "prod",
        "instances.json",
      ],
      {
        // Without PATH, reaching `bunx wrangler` would exit 1 rather than 3.
        env: { CLOUDFLARE_ACCOUNT_ID: "account" },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

    expect(exitCode).toBe(3);
    expect(stdout).toBe(`${credentialsMessage("missing CLOUDFLARE_API_TOKEN")}\n`);
  });
});
