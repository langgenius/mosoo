import { describe, expect, test } from "bun:test";

import {
  collectApplicationInstances,
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
