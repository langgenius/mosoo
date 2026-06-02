export function normalizeSessionTitle(title: string): string {
  const normalized = title.trim();

  if (!normalized) {
    throw new Error("Title is required.");
  }

  return normalized;
}

const PROMPT_TITLE_MAX_LENGTH = 80;

export function deriveSessionTitleFromPrompt(
  prompt: string,
  options: { timestampMs?: number } = {},
): string {
  const [firstParagraph] = prompt.trim().split(/\n{2,}/);
  const normalized = normalizeSessionTitle((firstParagraph ?? "").replaceAll(/\s+/g, " "));

  if (normalized.length < 5) {
    return `untitled-${(options.timestampMs ?? Date.now()).toString(36).slice(-6)}`;
  }

  return normalized.length > PROMPT_TITLE_MAX_LENGTH
    ? `${normalized.slice(0, PROMPT_TITLE_MAX_LENGTH - 1)}…`
    : normalized;
}
