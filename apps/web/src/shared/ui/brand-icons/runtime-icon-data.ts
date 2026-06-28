import claudeCodeSvgUrl from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import cursorAgentSvgUrl from "@lobehub/icons-static-svg/icons/cursor.svg";
import geminiSvgUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import hermesSvgUrl from "@lobehub/icons-static-svg/icons/hermesagent.svg";
import piSvgUrl from "@lobehub/icons-static-svg/icons/inflection.svg";
import openaiSvgUrl from "@lobehub/icons-static-svg/icons/openai.svg";
import openclawSvgUrl from "@lobehub/icons-static-svg/icons/openclaw-color.svg";
import opencodeSvgUrl from "@lobehub/icons-static-svg/icons/opencode.svg";
import { getRuntimeIconKey } from "@mosoo/runtime-catalog";

const RUNTIME_ICON_URL_BY_KEY: Record<string, string> = {
  "claude-code": claudeCodeSvgUrl,
  cursor: cursorAgentSvgUrl,
  gemini: geminiSvgUrl,
  hermes: hermesSvgUrl,
  openai: openaiSvgUrl,
  opencode: opencodeSvgUrl,
  openclaw: openclawSvgUrl,
  pi: piSvgUrl,
};

export function getRuntimeIconUrl(runtimeId: string): string | null {
  const iconKey = getRuntimeIconKey(runtimeId) ?? runtimeId;

  return RUNTIME_ICON_URL_BY_KEY[iconKey] ?? null;
}

export function hasRuntimeIcon(runtimeId: string): boolean {
  return getRuntimeIconUrl(runtimeId) !== null;
}
