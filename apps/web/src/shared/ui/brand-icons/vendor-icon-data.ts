import anthropicSvgUrl from "@lobehub/icons-static-svg/icons/anthropic.svg";
import deepseekSvgUrl from "@lobehub/icons-static-svg/icons/deepseek.svg";
import openaiSvgUrl from "@lobehub/icons-static-svg/icons/openai.svg";

export const VENDOR_ICON_URL: Record<string, string> = {
  anthropic: anthropicSvgUrl,
  deepseek: deepseekSvgUrl,
  openai: openaiSvgUrl,
};

export function hasVendorIcon(vendorId: string): boolean {
  return vendorId in VENDOR_ICON_URL;
}
