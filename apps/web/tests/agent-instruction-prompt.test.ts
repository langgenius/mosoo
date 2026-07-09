import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { Agent } from "../src/routes/agent/agent.types";
import type { AgentDistribution } from "../src/routes/agent/lifecycle/distribution-info";
import { buildAgentInstructionPrompt } from "../src/routes/agent/lifecycle/distribution-info";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const distribution: AgentDistribution = {
  apiBasePath: "/api/public/v1",
  apiBaseUrl: "https://console.test/api/public/v1",
  apiDocsUrl: "https://docs.test/api",
  apiPath: "POST /api/public/v1/agents/agent_123/threads",
  apiUrl: "https://console.test/api/public/v1/agents/agent_123/threads",
  openApiPath: "/api/public/v1/openapi.json",
  openApiUrl: "https://console.test/api/public/v1/openapi.json",
  threadsPath: "/threads?compose=1&agent=agent_123&lock=1",
  threadsUrl: "https://console.test/threads?compose=1&agent=agent_123&lock=1",
  tokenSettingsPath: "/settings/access-tokens",
  webUrl: "https://console.test/a/research-agent-agent1",
};

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    appId: "app_123",
    config: {
      builtInTools: [],
      environmentId: null,
      mcpServers: [],
      model: "gpt-5",
      prompt: "Research the request and return concise results.",
      providerOptions: {},
      skills: [],
    },
    createdAt: "2026-07-09T00:00:00Z",
    description: "Researches product questions through the public API.",
    id: "agent_123",
    kind: "cattle",
    liveVersion: null,
    name: "Research Agent",
    owner: {
      email: "owner@example.com",
      id: "user_123",
      name: "Owner",
    },
    packageResolution: null,
    provider: "openai",
    readiness: null,
    role: "owner",
    runtime: "openai-runtime",
    status: "published",
    tools: [],
    updatedAt: "2026-07-09T00:00:00Z",
    versions: [],
    visibility: "private",
    ...overrides,
  };
}

describe("agent instruction prompt", () => {
  test("builds markdown instructions with generated variables for coding agents", () => {
    const prompt = buildAgentInstructionPrompt(agent(), distribution);

    expect(prompt).toContain("# Instruction for LLM: Research Agent");
    expect(prompt).toContain("Use this `.md` instruction with a coding agent");
    expect(prompt).toContain("MOSOO_AGENT_ID=agent_123");
    expect(prompt).toContain(
      "MOSOO_CREATE_THREAD_URL=https://console.test/api/public/v1/agents/agent_123/threads",
    );
    expect(prompt).toContain("MOSOO_API_DOCS_URL=https://docs.test/api");
    expect(prompt).toContain("Read `MOSOO_API_TOKEN` from the environment");
    expect(prompt).toContain(
      'curl -X POST "https://console.test/api/public/v1/agents/agent_123/threads"',
    );
    expect(prompt).toContain("Job-style agent designed for one-shot calls");
    expect(prompt).not.toContain("skill.md");
  });

  test("uses the publish menu item as a clipboard instruction action", () => {
    const source = readSource("../src/routes/agent/lifecycle/publish-menu.tsx");

    expect(source).toContain("Instruction for LLM");
    expect(source).toContain("buildAgentInstructionPrompt(agent, distribution)");
    expect(source).toContain("navigator.clipboard.writeText");
    expect(source).not.toContain("downloadTextFile");
    expect(source).not.toContain("skill.md</span>");
  });
});
