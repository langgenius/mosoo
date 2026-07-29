import { describe, expect, test } from "bun:test";

import {
  disableWranglerRetainedVars,
  isContainerInactive,
  isContainerApplicationRolloutReady,
  parseContainerApplicationInfo,
  parseContainerApplications,
  parseContainerInstances,
  overrideContainerDeploymentConfig,
  selectWranglerEnvironmentConfig,
  selectReadyContainerApplication,
} from "../../lib/perf-stage-control";

describe("performance staging control plane", () => {
  test("deploys exact declared vars instead of inheriting remote drift", () => {
    expect(disableWranglerRetainedVars('name = "worker"\nkeep_vars = true\n')).toContain(
      "keep_vars = false",
    );
    expect(() => disableWranglerRetainedVars('name = "worker"\n')).toThrow("exactly once");
  });

  test("parses the deployed container application artifact", () => {
    expect(
      parseContainerApplications([
        {
          id: "application-id",
          image: "registry.example/image@sha256:abc",
          name: "perf-container",
          state: "ready",
          updated_at: "2026-07-19T00:00:00Z",
          version: 12,
        },
      ]),
    ).toEqual([
      {
        id: "application-id",
        image: "registry.example/image@sha256:abc",
        name: "perf-container",
        state: "ready",
        updatedAt: "2026-07-19T00:00:00Z",
        version: 12,
      },
    ]);
  });

  test("waits for both ready state and the expected Driver artifact", () => {
    const application = {
      id: "application-id",
      image: "registry.example/image@sha256:new",
      name: "perf-container",
      state: "ready",
      updatedAt: "2026-07-19T00:00:00Z",
      version: 5,
    } as const;

    expect(
      selectReadyContainerApplication({
        applications: [{ ...application, state: "active", version: 4 }],
        expectedDriverBundleSha256: "new-driver",
        name: application.name,
        observedDriverBundleSha256: "new-driver",
      }),
    ).toBeNull();
    expect(
      selectReadyContainerApplication({
        applications: [application],
        expectedDriverBundleSha256: "new-driver",
        name: application.name,
        observedDriverBundleSha256: "old-driver",
      }),
    ).toBeNull();
    expect(
      selectReadyContainerApplication({
        applications: [application],
        expectedDriverBundleSha256: "new-driver",
        name: application.name,
        observedDriverBundleSha256: "new-driver",
      }),
    ).toEqual(application);
  });

  test("rejects stale container configuration while a rollout is active", () => {
    const application = {
      id: "application-id",
      image: "registry.example/image@sha256:new",
      name: "perf-container",
      state: "ready",
      updatedAt: "2026-07-19T02:21:51.772Z",
      version: 23,
    } as const;
    const value = {
      active_rollout_id: "rollout-active",
      configuration: {
        disk: { size_mb: 4_000 },
        memory_mib: 1_024,
        vcpu: 0.25,
      },
      health: { instances: { scheduling: 2, starting: 33 } },
      id: "application-id",
      max_instances: 100,
      updated_at: "2026-07-19T02:21:51.772Z",
      version: 23,
    };
    const active = parseContainerApplicationInfo(value);
    expect(
      isContainerApplicationRolloutReady(application, active, {
        diskMb: 8_000,
        maxInstances: 100,
        memoryMib: 4_096,
        vcpu: 0.5,
      }),
    ).toBeFalse();

    const ready = parseContainerApplicationInfo({
      ...value,
      active_rollout_id: null,
      configuration: {
        disk: { size_mb: 8_000 },
        memory_mib: 4_096,
        vcpu: 0.5,
      },
      health: { instances: { scheduling: 0, starting: 0 } },
    });
    expect(
      isContainerApplicationRolloutReady(application, ready, {
        diskMb: 8_000,
        maxInstances: 100,
        memoryMib: 4_096,
        vcpu: 0.5,
      }),
    ).toBeTrue();

    expect(
      isContainerApplicationRolloutReady(
        application,
        { ...ready, version: application.version - 1 },
        {
          diskMb: 8_000,
          maxInstances: 100,
          memoryMib: 4_096,
          vcpu: 0.5,
        },
      ),
    ).toBeFalse();
  });

  test("overrides only the selected staging container block", () => {
    const config = [
      "[[env.prod.containers]]",
      'instance_type = "basic"',
      "max_instances = 1000",
      "",
      "[[env.perf_a.containers]]",
      'instance_type = "basic"',
      "max_instances = 1000",
      "",
      "[[env.perf_b.containers]]",
      'instance_type = "basic"',
      "max_instances = 1000",
      "",
    ].join("\n");
    const updated = overrideContainerDeploymentConfig(config, {
      environment: "perf_a",
      instanceType: "standard-1",
      maxInstances: 100,
    });

    expect(updated).toContain(
      ["[[env.perf_a.containers]]", 'instance_type = "standard-1"', "max_instances = 100"].join(
        "\n",
      ),
    );
    expect(updated.match(/instance_type = "basic"/gu)).toHaveLength(2);
    expect(updated.match(/max_instances = 1000/gu)).toHaveLength(2);
  });

  test("hashes only the selected Wrangler environment as treatment", () => {
    const config = [
      'main = "src/index.ts"',
      "",
      "[[migrations]]",
      'tag = "v1"',
      "",
      "[env.perf_a]",
      'name = "worker-a"',
      "[[env.perf_a.d1_databases]]",
      'database_id = "database-a"',
      "",
      "[env.perf_b]",
      'name = "worker-b"',
      "[[env.perf_b.d1_databases]]",
      'database_id = "database-b"',
      "",
    ].join("\n");

    const stackA = selectWranglerEnvironmentConfig(config, "perf_a");
    const stackB = selectWranglerEnvironmentConfig(config, "perf_b");
    expect(stackA).toContain('name = "worker-a"');
    expect(stackA).toContain('tag = "v1"');
    expect(stackA).not.toContain("worker-b");
    expect(stackB).toContain('name = "worker-b"');
    expect(stackB).toContain('tag = "v1"');
    expect(stackB).not.toContain("worker-a");
    expect(
      stackA
        .replaceAll("perf_a", "<stack>")
        .replaceAll("worker-a", "<worker>")
        .replaceAll("database-a", "<database>"),
    ).toBe(
      stackB
        .replaceAll("perf_b", "<stack>")
        .replaceAll("worker-b", "<worker>")
        .replaceAll("database-b", "<database>"),
    );
  });

  test("joins Durable Objects to live placements and distinguishes inactive cleanup", () => {
    const page = parseContainerInstances({
      result: {
        durable_objects: [
          {
            assigned_at: "2026-07-19T00:00:00Z",
            deployment_id: "deployment-live",
            id: "DO-LIVE",
            name: "sandbox-live",
          },
          {
            assigned_at: "2026-07-19T00:00:00Z",
            id: "DO-INACTIVE",
            name: "sandbox-inactive",
          },
        ],
        instances: [
          {
            app_version: 12,
            created_at: "2026-07-19T00:00:01Z",
            current_placement: {
              status: { container_status: "running", health: "running" },
            },
            id: "deployment-live",
            location: "sin06",
          },
        ],
      },
      result_info: { next_page_token: "next" },
      success: true,
    });

    expect(page.nextPageToken).toBe("next");
    expect(page.rows[0]).toMatchObject({
      appVersion: 12,
      deploymentId: "deployment-live",
      durableObjectId: "do-live",
      location: "sin06",
      state: "running",
    });
    expect(isContainerInactive(page.rows, "DO-LIVE")).toBeFalse();
    expect(isContainerInactive(page.rows, "DO-INACTIVE")).toBeTrue();
    expect(isContainerInactive(page.rows, "DO-ABSENT")).toBeTrue();
  });
});
