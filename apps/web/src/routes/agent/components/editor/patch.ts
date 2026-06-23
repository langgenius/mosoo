import type { AgentEditorDraft } from "./draft";

export function applyAgentEditorPatch(
  current: AgentEditorDraft,
  patch: Record<string, unknown>,
): AgentEditorDraft {
  const next = { ...current };
  const description = patch["description"];
  const environmentId = patch["environmentId"];
  const model = patch["model"];
  const name = patch["name"];
  const provider = patch["provider"];
  const prompt = patch["prompt"];

  if (typeof name === "string") {
    next.name = name;
  }
  if (typeof description === "string") {
    next.description = description;
  }
  if (typeof model === "string") {
    next.model = model;
  }
  if (typeof provider === "string") {
    next.provider = provider;
  }
  if (typeof prompt === "string") {
    next.prompt = prompt;
  }
  if (typeof environmentId === "string" || environmentId === null) {
    return withEnvironmentId(next, environmentId);
  }

  return next;
}

export function withEnvironmentId(
  current: AgentEditorDraft,
  environmentId: string | null,
): AgentEditorDraft {
  return {
    ...current,
    environmentId,
  };
}
