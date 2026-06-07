import { describe, expect, test } from "bun:test";

import { toAgentBuilderPlannerDraftContext } from "../src/modules/agent-builder/application/agent-builder-lightweight-manifest-projections";
import { collectAgentBuilderReadinessContext } from "../src/modules/agent-builder/application/agent-builder-readiness-context.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const agent = {
  id: "01J000000000000000000000A1",
  organizationId: "01J00000000000000000000006",
  ownerId: "01J00000000000000000000051",
} as const;

const completeDraftYaml = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Support Agent",
  "  description: Helps support teams.",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Help users.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
  "  spaces: []",
].join("\n");

describe("Agent Builder readiness context", () => {
  test("returns a local readiness issue for invalid Draft YAML", async () => {
    const readiness = await collectAgentBuilderReadinessContext({} as ApiBindings, {
      agent,
      draftYaml: "draft",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.errorCount).toBe(1);
    expect(readiness.warningCount).toBe(0);
    expect(readiness.issues).toEqual([
      {
        code: "agent_builder.draft_yaml.invalid",
        message: "Agent Builder Manifest YAML must be an object.",
        severity: "error",
      },
    ]);
  });

  test("rejects conflicting parsed and raw Draft inputs at runtime", async () => {
    const conflictingInput = {
      agent,
      draft: toAgentBuilderPlannerDraftContext(completeDraftYaml),
      draftYaml: "draft",
    };

    await expect(
      Reflect.apply(collectAgentBuilderReadinessContext, null, [
        {} as ApiBindings,
        conflictingInput,
      ]),
    ).rejects.toThrow(
      "Agent Builder draft context input must not provide both draft and draftYaml.",
    );
  });
});
