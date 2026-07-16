import { describe, expect, test } from "bun:test";

import type { SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getThreadRunFailure,
  ThreadRunFailureNotice,
} from "../src/routes/threads/detail/run-failure-notice";

function createRun(
  status: SessionRunStatus,
  error: SessionRunSummary["error"] = null,
): SessionRunSummary {
  return {
    completedAt: null,
    createdAt: "2026-07-16T09:21:41.000Z",
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    error,
    id: "01KXN3PND0KDGQQ0N74GWZFNWP",
    model: "gpt-5.6-sol",
    provider: "openai-compatible",
    startedAt: null,
    status,
    traceId: "4ad5f3de8f815bedab2855ec0e582367",
    trigger: "user_prompt",
    updatedAt: "2026-07-16T09:22:12.000Z",
  } as SessionRunSummary;
}

describe("thread run failure notice", () => {
  test("renders the persisted run error and process action", () => {
    const run = createRun("failed", {
      code: "runtime.provision_failed",
      details: {},
      message: "Driver process exited before ready with exit code 1.",
      retryable: true,
    });
    const html = renderToStaticMarkup(
      <ThreadRunFailureNotice onOpenProcess={() => undefined} run={run} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Driver process exited before ready with exit code 1.");
    expect(html).toContain("runtime.provision_failed");
    expect(html).toContain("View process");
  });

  test("provides status-specific copy when no run error was recorded", () => {
    expect(getThreadRunFailure(createRun("cancelled"))).toMatchObject({
      code: null,
      message: "The run was cancelled before it completed.",
      title: "Run cancelled",
    });
    expect(getThreadRunFailure(createRun("expired"))).toMatchObject({
      code: null,
      message: "The run expired before it completed.",
      title: "Run expired",
    });
  });

  test("does not render for a successful run", () => {
    const run = createRun("completed");

    expect(getThreadRunFailure(run)).toBeNull();
    expect(
      renderToStaticMarkup(<ThreadRunFailureNotice onOpenProcess={() => undefined} run={run} />),
    ).toBe("");
  });
});
