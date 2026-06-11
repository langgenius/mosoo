import { describe, expect, test } from "bun:test";

import {
  normalizeAgentStoredConfigJson,
  parseAgentStoredConfig,
  serializeAgentStoredConfig,
} from "../src/modules/agents/application/agent-stored-config.service";

describe("agent stored config", () => {
  test("normalizes legacy config with empty Builder metadata", () => {
    const normalized = JSON.parse(
      normalizeAgentStoredConfigJson(
        JSON.stringify({
          packageMcpServers: [],
          packageResolution: null,
          packageSharingEnabled: false,
          packageSkills: [],
        }),
      ),
    );

    expect(normalized.builder).toEqual({ componentDecisions: {} });
    expect(normalized.providerOptions).toEqual({});
  });

  test("round-trips Builder component decisions", () => {
    const configJson = serializeAgentStoredConfig({
      builder: {
        componentDecisions: {
          environment: "skipped",
        },
      },
      packageMcpServers: [],
      packageResolution: null,
      packageSharingEnabled: false,
      packageSkills: [],
      providerOptions: {
        model_providers: {
          "openai-compatible": {
            wire_api: "chat",
          },
        },
      },
    });

    expect(parseAgentStoredConfig(configJson).builder.componentDecisions.environment).toBe(
      "skipped",
    );
    expect(parseAgentStoredConfig(configJson).providerOptions).toEqual({
      model_providers: {
        "openai-compatible": {
          wire_api: "chat",
        },
      },
    });
  });

  test("normalizes Builder metadata while serializing stored config", () => {
    const staleConfig = {
      builder: {
        componentDecisions: {
          environment: "skipped" as const,
          skills: "skipped" as const,
        },
      },
      packageMcpServers: [],
      packageResolution: null,
      packageSharingEnabled: false,
      packageSkills: [],
      providerOptions: {},
    };
    const serialized = serializeAgentStoredConfig(staleConfig);

    expect(JSON.parse(serialized).builder.componentDecisions).toEqual({
      environment: "skipped",
    });
  });
});
