import { describe, expect, test } from "bun:test";

import {
  AppAgentBindingResolutionError,
  resolveAppAgentBindings,
} from "../src/modules/apps/application/app-agent-binding-resolution";
import type { AppDeploymentAgentBinding } from "../src/modules/apps/application/app-deployment-detector";

const BINDINGS: AppDeploymentAgentBinding[] = [
  { env: "ROADMAP_THREAD_URL", expose: "public_thread", name: "roadmap" },
  { env: "TRIAGE_THREAD_URL", expose: "public_thread", name: "triage" },
];

describe("resolveAppAgentBindings", () => {
  test("resolves every binding to its published agent", () => {
    expect(
      resolveAppAgentBindings(BINDINGS, [
        { id: "agt_3kf", name: "roadmap", published: true },
        { id: "agt_9wz", name: "triage", published: true },
      ]),
    ).toEqual([
      { agentId: "agt_3kf", envVar: "ROADMAP_THREAD_URL", expose: "public_thread", name: "roadmap" },
      { agentId: "agt_9wz", envVar: "TRIAGE_THREAD_URL", expose: "public_thread", name: "triage" },
    ]);
  });

  test("fails fast when a bound agent is missing", () => {
    expect(() =>
      resolveAppAgentBindings(BINDINGS, [{ id: "agt_3kf", name: "roadmap", published: true }]),
    ).toThrow(AppAgentBindingResolutionError);
  });

  test("fails fast with the published code when a bound agent is not live", () => {
    try {
      resolveAppAgentBindings(BINDINGS, [
        { id: "agt_3kf", name: "roadmap", published: true },
        { id: "agt_9wz", name: "triage", published: false },
      ]);
      throw new Error("expected resolution to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppAgentBindingResolutionError);
      expect((error as AppAgentBindingResolutionError).code).toBe("deployment_agent_not_published");
    }
  });

  test("resolves to an empty list when there are no bindings", () => {
    expect(resolveAppAgentBindings([], [])).toEqual([]);
  });
});
