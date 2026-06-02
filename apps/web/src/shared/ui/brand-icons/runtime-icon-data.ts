import claudeCodeSvgUrl from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import cursorAgentSvgUrl from "@lobehub/icons-static-svg/icons/cursor.svg";
import geminiSvgUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import hermesSvgUrl from "@lobehub/icons-static-svg/icons/hermesagent.svg";
import piSvgUrl from "@lobehub/icons-static-svg/icons/inflection.svg";
import openaiSvgUrl from "@lobehub/icons-static-svg/icons/openai.svg";
import openclawSvgUrl from "@lobehub/icons-static-svg/icons/openclaw-color.svg";
import opencodeSvgUrl from "@lobehub/icons-static-svg/icons/opencode.svg";

export const RUNTIME_ICON_URL: Record<string, string> = {
  "claude-agent-sdk": claudeCodeSvgUrl,
  "cursor-agent": cursorAgentSvgUrl,
  gemini: geminiSvgUrl,
  hermes: hermesSvgUrl,
  "openai-runtime": openaiSvgUrl,
  openclaw: openclawSvgUrl,
  opencode: opencodeSvgUrl,
  pi: piSvgUrl,
};

export function hasRuntimeIcon(runtimeId: string): boolean {
  return runtimeId in RUNTIME_ICON_URL;
}
