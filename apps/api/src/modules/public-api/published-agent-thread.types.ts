import type { AgentId, FileId, PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { PublicApiCaller } from "../auth/application/public-api-caller.service";

export interface CreatePublishedAgentThreadInput {
  clientExternalRef?: string | undefined;
  fileIds: FileId[];
  inputText: string;
}

export interface CreatePublishedAgentThreadRequest {
  agentId: AgentId;
  bindings: ApiBindings;
  caller: PublicApiCaller;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: CreatePublishedAgentThreadInput;
  requestUrl: string;
}

export interface RetrievePublishedAgentThreadRequest {
  caller: PublicApiCaller;
  database: D1Database;
  threadId: PublicThreadId;
}

export interface ListPublishedAgentThreadEventsRequest {
  caller: PublicApiCaller;
  database: D1Database;
  limit: number;
  threadId: PublicThreadId;
}
