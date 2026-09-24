import { expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { hydrateCachedRunContextFromSession } from "../src/modules/runtime/application/session-definition/hydrate-run-context.service";
import { getSessionExecutionPlan } from "../src/modules/runtime/application/session-definition/session-execution.repository";
import { createAgentSession } from "../src/modules/runtime/application/session-runs/create-agent-session.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS as ids,
} from "./helpers/public-api-http-test-fixture";

const viewer: AuthenticatedViewer = {
  id: ids.ownerAccount,
  email: "owner@example.com",
  emailVerified: true,
  imageUrl: null,
  name: "Owner",
};

test.each([false, true])(
  "rejects frozen restrictions before provisioning (cached=%s)",
  async (cached) => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5.4" }] });
    let session;
    try {
      session = await createAgentSession({
        bindings,
        input: { agentId: ids.agent, projectId: ids.project, type: "ui" },
        viewer,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    if (cached) {
      const hydrated = await hydrateCachedRunContextFromSession(bindings, viewer, session);
      expect(hydrated.cacheHit).toBe(false);
      expect((await hydrateCachedRunContextFromSession(bindings, viewer, session)).cacheHit).toBe(
        true,
      );
    }
    const plan = await getSessionExecutionPlan(database, session.id);
    const restrictedPlan = {
      ...plan,
      builtInTools: plan.builtInTools.map((tool) => ({ name: tool.name, enabled: false })),
    };
    // Model the legacy snapshot independently of the now-valid editable Agent/live version.
    await database
      .prepare("UPDATE session_execution_snapshot SET plan_json = ? WHERE session_id = ?")
      .bind(JSON.stringify(restrictedPlan), session.id)
      .run();
    const subjectsBefore = await database.prepare("SELECT COUNT(*) AS count FROM sandbox").first();
    await expect(
      hydrateCachedRunContextFromSession(bindings, viewer, session),
    ).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_READY",
      message: expect.stringContaining("does not support disabling"),
    });
    expect(await getSessionExecutionPlan(database, session.id)).toEqual(restrictedPlan);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM sandbox").first()).toEqual(
      subjectsBefore,
    );
  },
);
