import { createHash } from "node:crypto";

const RANGE = Array.from({ length: 120 }, (_, index) => String(index + 1)).join(",");

export const RUNTIME_E2E_EXPECTED_OUTPUT = `RUNTIME_SCOREBOARD. ${RANGE}`;
export const RUNTIME_E2E_PROMPT = [
  "Copy the next line exactly as your entire response.",
  "Do not add quotes, Markdown, a prefix, a suffix, or an explanation.",
  RUNTIME_E2E_EXPECTED_OUTPUT,
].join("\n");
export const RUNTIME_E2E_SYSTEM_PROMPT = "Reply concisely. Do not use tools.";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
