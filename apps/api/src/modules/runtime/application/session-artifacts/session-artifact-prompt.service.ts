const RUNTIME_ARTIFACT_MANIFEST_PROMPT = [
  "Runtime artifact delivery:",
  "When you create files that the user should download or keep as session outputs, write a JSON manifest at `.mosoo/artifacts.json` relative to the current working directory after the output files exist.",
  'Use this shape: {"artifacts":[{"path":"dist/output.txt","contentType":"text/plain"}]}.',
  "Only include intended deliverables. Artifact paths must be relative to the current working directory.",
].join("\n");

export function appendRuntimeArtifactContextToPrompt(prompt: string): string {
  const profilePrompt = prompt.trim();

  if (profilePrompt.length === 0) {
    return RUNTIME_ARTIFACT_MANIFEST_PROMPT;
  }

  return [profilePrompt, RUNTIME_ARTIFACT_MANIFEST_PROMPT].join("\n\n");
}
