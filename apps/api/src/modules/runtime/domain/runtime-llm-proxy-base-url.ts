import type { PresetModelProtocol } from "@mosoo/contracts/models";

/** Normalize only admitted Messages endpoints across native and AI SDK clients. */
export function resolveRuntimeLlmUpstreamPath(input: {
  basePath: string;
  subPath: string;
  modelProtocol: PresetModelProtocol;
}): string {
  if (input.modelProtocol !== "anthropic-messages") return input.subPath;
  const endpoint = input.subPath.startsWith("/v1/") ? input.subPath.slice(3) : input.subPath;
  if (endpoint !== "/messages" && endpoint !== "/messages/count_tokens") return input.subPath;
  return input.basePath.replace(/\/+$/u, "").endsWith("/v1") ? endpoint : `/v1${endpoint}`;
}
