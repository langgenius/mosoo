import { describe, expect, test } from "bun:test";

import { parseAgentBuilderPlannerDraft } from "../src/modules/agent-builder/application/agent-builder-draft-parser";

const SPACE_FROM_PATCH_ID = "01J000000000000000000000E1";
const SPACE_FROM_OBJECT_ID = "01J000000000000000000000E2";
const SPACE_DELETED_ID = "01J000000000000000000000E3";

describe("Agent Builder draft parser", () => {
  test("rejects non-object Draft YAML roots", () => {
    expect(parseAgentBuilderPlannerDraft("[]")).toMatchObject({
      parseError: expect.any(String),
      parseStatus: "failed",
    });
    expect(parseAgentBuilderPlannerDraft("draft")).toMatchObject({
      parseError: expect.any(String),
      parseStatus: "failed",
    });
  });

  test("reads Space bindings from persisted string arrays and object bindings", () => {
    const draft = parseAgentBuilderPlannerDraft(
      [
        "version: 1",
        "kind: pet",
        "assets:",
        "  spaces:",
        `    - ${SPACE_FROM_PATCH_ID}`,
        `    - id: ${SPACE_FROM_OBJECT_ID}`,
        "      name: Object Space",
        `    - ${SPACE_FROM_OBJECT_ID}`,
        `    - id: ${SPACE_DELETED_ID}`,
        "      name: Deleted Space",
        "      state: tombstone",
      ].join("\n"),
    );

    expect(draft.spaceIds).toEqual([SPACE_FROM_PATCH_ID, SPACE_FROM_OBJECT_ID]);
    expect(draft.spaces).toEqual([
      { id: SPACE_FROM_PATCH_ID, name: SPACE_FROM_PATCH_ID },
      { id: SPACE_FROM_OBJECT_ID, name: "Object Space" },
    ]);
  });

  test("rejects malformed platform IDs in Draft asset bindings", () => {
    expect(
      parseAgentBuilderPlannerDraft(
        ["version: 1", "kind: pet", "assets:", "  skills:", "    - skill_not_a_platform_id"].join(
          "\n",
        ),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("assets.skills"),
      parseStatus: "failed",
    });
  });
});
