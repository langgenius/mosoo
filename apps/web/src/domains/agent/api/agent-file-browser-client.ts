import type { AgentId } from "@mosoo/contracts/id";

import type { AgentFileContentQuery, AgentFileTreeQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { apiPath } from "@/platform/http/public-api";

import { AGENT_FILE_CONTENT_QUERY, AGENT_FILE_TREE_QUERY } from "./agent-file-browser-documents";

export type AgentFileTree = AgentFileTreeQuery["agentFileTree"];
export type AgentFileEntry = AgentFileTree["entries"][number];
export type AgentFileContent = AgentFileContentQuery["agentFileContent"];

export async function getAgentFileTree(input: {
  agentId: AgentId;
  path: string;
}): Promise<AgentFileTree> {
  const payload = await requestGraphQL(AGENT_FILE_TREE_QUERY, input);

  return payload.agentFileTree;
}

export async function getAgentFileContent(input: {
  agentId: AgentId;
  path: string;
}): Promise<AgentFileContent> {
  const payload = await requestGraphQL(AGENT_FILE_CONTENT_QUERY, input);

  return payload.agentFileContent;
}

export function getAgentFileDownloadUrl(input: { agentId: AgentId; path: string }): string {
  return apiPath(
    `/agent/${encodeURIComponent(input.agentId)}/file?path=${encodeURIComponent(input.path)}&download=1`,
  );
}
