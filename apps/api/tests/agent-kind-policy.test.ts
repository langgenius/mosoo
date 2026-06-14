import { describe, expect, test } from "bun:test";

import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import { enforceAgentKindChangeAllowed } from "../src/modules/agents/application/agent-kind-policy.service";
import type { AgentRow } from "../src/modules/agents/application/agent-types";

const baseAgent: AgentRow = {
  configJson: "{}",
  createdAt: 1,
  description: null,
  environmentId: null,
  id: PLATFORM_ID_FIXTURES.agent,
  kind: "pet",
  liveDeploymentVersionId: null,
  model: "gpt-5",
  name: "Agent",
  organizationId: PLATFORM_ID_FIXTURES.organization,
  ownerId: PLATFORM_ID_FIXTURES.account,
  appId: PLATFORM_ID_FIXTURES.app,
  prompt: "Help",
  provider: "openai",
  runtimeId: "openai-runtime",
  status: "draft",
  updatedAt: 1,
  visibility: "private",
};

describe("agent kind policy", () => {
  test("allows kind changes before publishing", () => {
    expect(() => enforceAgentKindChangeAllowed(baseAgent, "cattle")).not.toThrow();
  });

  test("fails closed on kind changes after publishing", () => {
    expect(() =>
      enforceAgentKindChangeAllowed(
        {
          ...baseAgent,
          status: "published",
        },
        "cattle",
      ),
    ).toThrow("Agent type is locked after publishing. Fork to switch type.");
  });

  test("fails closed when a live deployment version exists", () => {
    expect(() =>
      enforceAgentKindChangeAllowed(
        {
          ...baseAgent,
          liveDeploymentVersionId: PLATFORM_ID_FIXTURES.agentDeploymentVersion,
        },
        "cattle",
      ),
    ).toThrow("Agent type is locked after publishing. Fork to switch type.");
  });
});
