import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { setTimeout } from "node:timers/promises";

import { AcpJsonRpcConnection } from "../src/runtimes/acp/acp-json";

interface TestConnection {
  readonly connection: AcpJsonRpcConnection;
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
}

function createConnection(input?: { readonly transportErrors?: string[] }): TestConnection {
  const stdin = new PassThrough();
  const stdout = new PassThrough();

  return {
    connection: new AcpJsonRpcConnection({
      onInvalidMessage: () => undefined,
      onNotification: async () => undefined,
      onRequest: async () => null,
      onTransportError: (error) => {
        input?.transportErrors?.push(error.message);
      },
      stdin,
      stdout,
    }),
    stdin,
    stdout,
  };
}

function closeStreams(input: TestConnection): void {
  input.stdin.destroy();
  input.stdout.destroy();
}

describe("ACP JSON-RPC connection", () => {
  test("closes the connection when the readable stream closes", async () => {
    const transportErrors: string[] = [];
    const rpc = createConnection({ transportErrors });
    const request = rpc.connection.request("ping", {});

    rpc.stdout.end();

    try {
      const outcome = await Promise.race([
        request.then(
          () => ({ status: "resolved" as const }),
          (error: unknown) => ({
            message: error instanceof Error ? error.message : "unknown error",
            status: "rejected" as const,
          }),
        ),
        setTimeout(100).then(() => ({ status: "pending" as const })),
      ]);

      expect(outcome).toMatchObject({
        message: expect.any(String),
        status: "rejected",
      });
      expect(transportErrors).toHaveLength(1);
    } finally {
      closeStreams(rpc);
    }
  });

  test("rejects pending requests when the connection closes", async () => {
    const rpc = createConnection();
    const request = rpc.connection.request("ping", {});

    rpc.connection.close("test cleanup");

    try {
      await expect(request).rejects.toThrow();
    } finally {
      closeStreams(rpc);
    }
  });
});
