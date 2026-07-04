import claudeCodeSvgUrl from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import clineSvgUrl from "@lobehub/icons-static-svg/icons/cline.svg";
import codexSvgUrl from "@lobehub/icons-static-svg/icons/codex-color.svg";
import cursorSvgUrl from "@lobehub/icons-static-svg/icons/cursor.svg";
import openaiSvgUrl from "@lobehub/icons-static-svg/icons/openai.svg";
import opencodeSvgUrl from "@lobehub/icons-static-svg/icons/opencode.svg";
// Import from the lean /icons entry point, not the package root: the root
// pulls the full catalog plus @mosoo/contracts' arktype runtime (~50 KB gz)
// into every chunk that renders a RuntimeIcon, which is nearly every page.
import { getRuntimeIconKey } from "@mosoo/runtime-catalog/icons";

const RUNTIME_ICON_URL_BY_KEY: Record<string, string> = {
  "claude-code": claudeCodeSvgUrl,
  cline: clineSvgUrl,
  codex: codexSvgUrl,
  cursor: cursorSvgUrl,
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
