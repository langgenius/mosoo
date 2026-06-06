import { describe, expect, test } from "bun:test";

import type { AgentDetail, AgentEditorState } from "@mosoo/contracts/agent";

import { mapAgentDetailToView } from "../src/routes/agent/agent-view.mapper";

const AGENT_ID = "01J000000000000000000000C1";
const ORGANIZATION_ID = "01J000000000000000000000C2";
const OWNER_ID = "01J000000000000000000000C3";
const COLLABORATOR_ID = "01J000000000000000000000C4";

function detail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    createdAt: "2026-06-06T00:00:00.000Z",
    description: "Description",
    id: AGENT_ID,
    kind: "pet",
    liveVersion: null,
    model: "gpt-5",
    name: "Agent",
    organizationId: ORGANIZATION_ID,
    owner: { id: OWNER_ID, imageUrl: null, name: "Owner" },
    packageSharingEnabled: false,
    prompt: "Help",
    provider: "openai",
    runtimeId: "openai-runtime",
    skills: [],
    status: "published",
    tools: [],
    updatedAt: "2026-06-06T00:00:00.000Z",
    versions: [],
    viewerRole: "admin",
    visibility: "organization",
    ...overrides,
  };
}

function editorState(overrides: Partial<AgentEditorState> = {}): AgentEditorState {
  return {
    collaborators: [],
    environment: { agentsFileId: null, boundSpaceIds: [], environmentId: null },
    id: AGENT_ID,
    mcpBindings: [],
    packageResolution: null,
    readiness: { checkedAt: "2026-06-06T00:00:00.000Z", issues: [], ready: true },
    ...overrides,
  };
}

describe("mapAgentDetailToView collaborators", () => {
  test("drops the org-wide '*' principal so it is not duplicated alongside the visibility row", () => {
    const agent = mapAgentDetailToView(
      detail(),
      editorState({
        collaborators: [
          {
            email: null,
            imageUrl: null,
            name: "Everyone in organization",
            principal: "*",
            role: "user",
          },
          {
            email: "member@example.com",
            imageUrl: null,
            name: "Member",
            principal: COLLABORATOR_ID,
            role: "user",
          },
        ],
      }),
      null,
    );

    expect(agent.collaborators.map((c) => c.user.id)).toEqual([COLLABORATOR_ID]);
  });
});
