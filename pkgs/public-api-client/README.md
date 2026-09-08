# `@mosoo/sdk`

Public Beta TypeScript SDK for calling a published Mosoo Agent from a trusted backend.

## Install

```sh
npm install @mosoo/sdk@beta
```

## Quickstart

```ts
import { Mosoo } from "@mosoo/sdk";

const mosoo = new Mosoo({ token: process.env.MOSOO_API_TOKEN! });
const requestId = crypto.randomUUID(); // Persist this value if the request may be retried.

const created = await mosoo.createThread({
  agentId: process.env.MOSOO_AGENT_ID!,
  idempotencyKey: requestId,
  input: "Prepare the requested deliverable.",
  userId: "your-application-user-id",
});

if (created.run === null) {
  throw new Error("The Thread did not start a Run.");
}

// Persist these before waiting so another process can resume the task.
const { id: threadId } = created.thread;
const { id: runId } = created.run;

const result = await mosoo.waitForFinalOutput({ threadId, runId });
console.log(result.finalOutput.text);
console.log(result.run.artifacts ?? []);
```

`MOSOO_API_TOKEN` is an App-owner secret. Do not expose it to browser or mobile clients. Pass `baseUrl` only for a self-hosted Mosoo deployment.

Supported runtimes for this ESM-only Beta are Node.js 22/24 LTS and Cloudflare Workers. Bun, Deno, browsers, and mobile clients are not yet supported.

Live events are a Beta progress surface. Use the terminal Run snapshot as the source of truth for completion and final output.

Agent output files are exposed as typed `run.artifacts` and on matching `session_files.updated` events. Each artifact carries stable `fileId` and `runId` values; use `listFiles()` for the complete Thread file list, not filename matching for identity.

The Beta keeps file upload at the existing `Blob`/`FormData` boundary and does not promise a high-level large-file streaming API.

## License

Apache-2.0
