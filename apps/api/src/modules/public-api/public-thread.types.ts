import type { AgentId, FileId, PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { PublicApiCaller } from "../auth/application/public-api-caller.service";

export interface CreatePublicThreadInput {
  clientExternalRef?: string | undefined;
  fileIds: FileId[];
  inputText?: string | undefined;
}

export interface CreatePublicThreadRequest {
  agentId: AgentId;
  bindings: ApiBindings;
  caller: PublicApiCaller;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  idempotencyKey: string | null;
  input: CreatePublicThreadInput;
  requestUrl: string;
}

export interface RetrievePublicThreadRequest {
  caller: PublicApiCaller;
  database: D1Database;
  threadId: PublicThreadId;
}

export interface ListPublicThreadEventsRequest {
  caller: PublicApiCaller;
  database: D1Database;
  limit: number;
  threadId: PublicThreadId;
}

export interface StreamPublicThreadEventsRequest extends ListPublicThreadEventsRequest {
  bindings: ApiBindings;
  signal?: AbortSignal | null | undefined;
}
