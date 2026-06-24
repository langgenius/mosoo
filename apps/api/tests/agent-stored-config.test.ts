import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import {
  normalizeAgentStoredConfigJson,
  parseAgentStoredConfig,
  serializeAgentStoredConfig,
} from "../src/modules/agents/application/agent-stored-config.service";

describe("agent stored config", () => {
  test("normalizes legacy config without Builder metadata", () => {
    const normalized = JSON.parse(
      normalizeAgentStoredConfigJson(
        JSON.stringify({
          packageMcpServers: [],
          packageResolution: null,
          packageSkills: [],
        }),
      ),
    );

    expect(normalized).not.toHaveProperty("builder");
    expect(normalized).not.toHaveProperty("packageSharingEnabled");
    expect(normalized.builtInTools).toEqual(createDefaultAgentBuiltInTools());
    expect(normalized.providerOptions).toEqual({});
  });

  test("ignores legacy Builder metadata while parsing stored config", () => {
    const configJson = JSON.stringify({
      builder: {
        componentDecisions: {
          environment: "skipped",
        },
      },
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      providerOptions: {
        model_providers: {
          "openai-compatible": {
            wire_api: "chat",
          },
        },
      },
    });

    expect(parseAgentStoredConfig(configJson).providerOptions).toEqual({
      model_providers: {
        "openai-compatible": {
          wire_api: "chat",
        },
      },
    });
    expect(parseAgentStoredConfig(configJson).builtInTools).toEqual(
      createDefaultAgentBuiltInTools(),
    );
  });

  test("serializes stored config without Builder metadata", () => {
    const serialized = serializeAgentStoredConfig({
      builtInTools: [
        { enabled: false, name: "bash" },
        { enabled: true, name: "read" },
      ],
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      providerOptions: {},
    });

    expect(JSON.parse(serialized)).not.toHaveProperty("builder");
    expect(JSON.parse(serialized).builtInTools).toContainEqual({ enabled: false, name: "bash" });
  });
});
