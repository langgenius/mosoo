import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { AppDeployment, AppDeploymentRun, AppDeploymentRunStatus } from "@mosoo/contracts/app";

import type { AppDeploymentOverview } from "../src/domains/app/api/app-deployment-client";
import { toDeployConsoleState } from "../src/routes/app-overview/deploy/deploy-console-mapping";
import {
  toDeploymentRunOutcome,
  toProductionEnvironmentStatus,
} from "../src/routes/app-overview/deploy/deployment-status";

function deploymentRun(id: string, status: AppDeploymentRunStatus): AppDeploymentRun {
  return {
    appId: "01APP000000000000000000000" as AppDeploymentRun["appId"],
    createdAt: "2026-07-10T00:00:00.000Z",
    deploymentId: "01DEPLOYMENT00000000000000" as AppDeploymentRun["deploymentId"],
    errorCode: null,
    errorMessage: null,
    id: id as AppDeploymentRun["id"],
    liveUrl: status === "success" ? "https://app.apps.mosoo.ai" : null,
    plannedUrl: "https://app.apps.mosoo.ai",
    sourceBranch: "main",
    sourceCommitSha: "abcdef1234567890",
    status,
    targetKind: "cloudflare_worker",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("deployment status presentation", () => {
  test("collapses executor phases into three user-facing outcomes", () => {
    const cases: Array<[AppDeploymentRunStatus, ReturnType<typeof toDeploymentRunOutcome>]> = [
      ["queued", "deploying"],
      ["preparing", "deploying"],
      ["building", "deploying"],
      ["submitting", "deploying"],
      ["submitted", "deploying"],
      ["activating", "deploying"],
      ["success", "successful"],
      ["failed", "failed"],
    ];

    for (const [status, outcome] of cases) {
      expect(toDeploymentRunOutcome(status)).toBe(outcome);
    }
  });

  test("keeps production live when the latest attempt is deploying or failed", () => {
    expect(toProductionEnvironmentStatus("https://app.apps.mosoo.ai", "deploying")).toBe("live");
    expect(toProductionEnvironmentStatus("https://app.apps.mosoo.ai", "failed")).toBe("live");
  });

  test("keeps every successful history row successful", () => {
    const newest = deploymentRun("01RUN0000000000000000000002", "success");
    const older = deploymentRun("01RUN0000000000000000000001", "success");
    const deployment: AppDeployment = {
      appId: newest.appId,
      createdAt: newest.createdAt,
      defaultBranch: "main",
      id: newest.deploymentId,
      latestRun: newest,
      liveUrl: newest.liveUrl,
      plannedUrl: newest.plannedUrl,
      repoName: "app",
      repoOwner: "mosoo",
      repoUrl: "https://github.com/mosoo/app.git",
      updatedAt: newest.updatedAt,
    };
    const overview: AppDeploymentOverview = {
      appName: "App",
      boundAgents: [],
      deployment,
    };

    const state = toDeployConsoleState(overview, [newest, older]);

    expect(state.runs.map((run) => run.outcome)).toEqual(["successful", "successful"]);
  });

  test("reports deploying or unavailable before the first successful deploy", () => {
    expect(toProductionEnvironmentStatus(null, "deploying")).toBe("deploying");
    expect(toProductionEnvironmentStatus(null, "failed")).toBe("unavailable");
    expect(toProductionEnvironmentStatus(null, undefined)).toBe("unavailable");
  });

  test("keeps internal phases and superseded out of presentation components", () => {
    const badgeSource = readSource(
      "../src/routes/app-overview/deploy/components/deploy-status-badge.tsx",
    );
    const urlCardSource = readSource(
      "../src/routes/app-overview/deploy/components/deploy-url-card.tsx",
    );

    expect(badgeSource).toContain('"Deploying…"');
    expect(badgeSource).toContain('"Successful"');
    expect(badgeSource).toContain('"Failed"');
    expect(badgeSource).not.toMatch(/Queued|Preparing|Building|Submitting|Submitted|Activating/u);
    expect(badgeSource).not.toContain("Superseded");
    expect(urlCardSource).not.toContain("DEPLOY_PHASES");
    expect(urlCardSource).not.toContain("Deploy progress");
  });
});
