import { describe, expect, test } from "bun:test";

import {
  createStarterPackBatchApprovalInput,
  createStarterPackSingleApprovalInput,
} from "../src/routes/agent/components/agent-builder/starter-pack-approval-submission";

const PLANNER_RUN_ID = "01J000000000000000000000A1";

describe("Agent Builder Starter Pack approval submission", () => {
  test("creates a single approval mutation input with normalized identifiers", () => {
    expect(
      createStarterPackSingleApprovalInput({
        nodeKey: "  linear_skill  ",
        plannerRunId: `  ${PLANNER_RUN_ID.toLowerCase()}  `,
      }),
    ).toEqual({
      mode: "SINGLE",
      nodeKey: "linear_skill",
      plannerRunId: PLANNER_RUN_ID,
    });
  });

  test("creates a batch approval mutation input without trusting client-selected node keys", () => {
    expect(
      createStarterPackBatchApprovalInput({
        nodeKeys: ["draft_name", "skill_linear"],
        plannerRunId: PLANNER_RUN_ID,
      }),
    ).toEqual({
      mode: "BATCH",
      nodeKey: null,
      plannerRunId: PLANNER_RUN_ID,
    });
  });

  test("rejects empty approval identities", () => {
    expect(() =>
      createStarterPackSingleApprovalInput({
        nodeKey: " ",
        plannerRunId: PLANNER_RUN_ID,
      }),
    ).toThrow("Starter Pack single approval requires nodeKey and plannerRunId.");

    expect(() =>
      createStarterPackBatchApprovalInput({
        nodeKeys: [],
        plannerRunId: PLANNER_RUN_ID,
      }),
    ).toThrow("Starter Pack batch approval requires approvable node keys and plannerRunId.");
  });
});
