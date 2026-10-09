import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import {
  parseAgentStoredConfig,
  serializeAgentStoredConfig,
} from "../src/modules/agents/application/agent-stored-config.service";

describe("agent stored config", () => {
  test("writes every key that rollback builds require", () => {
    expect(JSON.parse(serializeAgentStoredConfig(parseAgentStoredConfig("{}")))).toEqual({
      builtInTools: createDefaultAgentBuiltInTools(),
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      providerOptions: {},
    });
  });

  test("reads legacy rows that omit settings", () => {
    const config = parseAgentStoredConfig(
      JSON.stringify({
        builder: { componentDecisions: { environment: "skipped" } },
        packageMcpServers: [],
        packageResolution: null,
        packageSkills: [],
      }),
    );

    expect(config.builtInTools).toEqual(createDefaultAgentBuiltInTools());
    expect(config.providerOptions).toEqual({});
  });
});
