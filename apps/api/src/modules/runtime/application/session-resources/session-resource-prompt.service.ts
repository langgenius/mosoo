import type { SessionResourcePathEntry } from "../../../files/application/file-store";

function formatByteCount(bytes: number): string {
  return bytes === 1 ? "1 byte" : `${bytes} bytes`;
}

export function appendSessionResourceContextToPrompt(
  prompt: string,
  resources: readonly SessionResourcePathEntry[],
): string {
  if (resources.length === 0) {
    return prompt;
  }

  return [
    "Session files available to this turn:",
    "These files are persisted for this session and mounted read-only relative to the current working directory. Use the paths exactly as shown.",
    ...resources.map(
      (resource) => `- ${resource.path} (${resource.name}, ${formatByteCount(resource.size)})`,
    ),
    "",
    "User message:",
    prompt,
  ].join("\n");
}
