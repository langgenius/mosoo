import { Mosoo, MosooPublicApiAbortError, verifyDelegation } from "@mosoo/sdk";

interface FixtureRequest {
  apiBaseUrl: string;
  apiToken: string;
  delegationAudience: string;
  delegationToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFixtureRequest(input: unknown): input is FixtureRequest {
  if (!isRecord(input)) {
    return false;
  }

  return (
    typeof input["apiBaseUrl"] === "string" &&
    typeof input["apiToken"] === "string" &&
    typeof input["delegationAudience"] === "string" &&
    typeof input["delegationToken"] === "string"
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const input: unknown = await request.json();

      if (!isFixtureRequest(input)) {
        return Response.json({ error: "Invalid fixture request." }, { status: 400 });
      }

      const mosoo = new Mosoo({ baseUrl: input.apiBaseUrl, token: input.apiToken });
      const upload = await mosoo.uploadAgentFile({
        agentId: "agent-1",
        file: new Blob(["Worker upload."], { type: "text/plain" }),
        filename: "worker.txt",
      });
      const created = await mosoo.createThread({
        agentId: "agent-1",
        idempotencyKey: "worker-operation-1",
        input: "Run from a Worker.",
        userId: "worker-user",
      });

      if (created.run === null) {
        throw new Error("Fixture Thread did not start a Run.");
      }

      const terminal = await mosoo.waitForFinalOutput({
        runId: created.run.id,
        threadId: created.thread.id,
      });
      const events = [];

      for await (const event of mosoo.streamEvents({ threadId: created.thread.id })) {
        events.push(event.content);
      }

      const controller = new AbortController();
      controller.abort();
      let aborted = false;

      try {
        await mosoo.waitForRun({ signal: controller.signal, threadId: created.thread.id });
      } catch (error) {
        aborted = error instanceof MosooPublicApiAbortError;
      }

      if (!aborted) {
        throw new Error("Worker AbortSignal was not preserved as a typed SDK error.");
      }

      const delegation = await verifyDelegation({
        accessToken: input.apiToken,
        audience: input.delegationAudience,
        token: input.delegationToken,
      });

      return Response.json({
        aborted,
        delegationUserId: delegation.userId,
        eventContent: events.join(""),
        fileName: upload.file.name,
        finalText: terminal.finalOutput.text,
        runId: created.run.id,
        threadId: created.thread.id,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown Worker fixture error." },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler;
