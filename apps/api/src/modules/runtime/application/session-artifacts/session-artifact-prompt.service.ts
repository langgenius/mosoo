const RUNTIME_ARTIFACT_OUTPUT_PROMPT = [
  "Runtime artifact delivery:",
  "`outputs/` relative to the current working directory is the only user-downloadable session output directory. Files written anywhere else are scratch runtime workspace files and are not user-accessible.",
  "When the task result is a file, or the user asks for a file by name, type, content, or transformation, write the final version under `outputs/` even if the user does not explicitly ask for a download link.",
  "Use workspace paths outside `outputs/` only for scratch files, intermediate build files, cloned repositories, ordinary source edits, or temporary implementation work. If source work also produces a user-facing deliverable, put that final deliverable under `outputs/`.",
].join("\n");

export function appendRuntimeArtifactContextToPrompt(prompt: string): string {
  const profilePrompt = prompt.trim();

  if (profilePrompt.length === 0) {
    return RUNTIME_ARTIFACT_OUTPUT_PROMPT;
  }

  return [profilePrompt, RUNTIME_ARTIFACT_OUTPUT_PROMPT].join("\n\n");
}
