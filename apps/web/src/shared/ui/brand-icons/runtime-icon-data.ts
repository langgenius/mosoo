import claudeCodeSvgUrl from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import openaiSvgUrl from "@lobehub/icons-static-svg/icons/openai.svg";
import opencodeSvgUrl from "@lobehub/icons-static-svg/icons/opencode.svg";
import { getRuntimeIconKey } from "@mosoo/runtime-catalog";

const RUNTIME_ICON_URL_BY_KEY: Record<string, string> = {
  "claude-code": claudeCodeSvgUrl,
  openai: openaiSvgUrl,
  opencode: opencodeSvgUrl,
};

export function getRuntimeIconUrl(runtimeId: string): string | null {
  const iconKey = getRuntimeIconKey(runtimeId) ?? runtimeId;

  return RUNTIME_ICON_URL_BY_KEY[iconKey] ?? null;
}

export function hasRuntimeIcon(runtimeId: string): boolean {
  return getRuntimeIconUrl(runtimeId) !== null;
}
