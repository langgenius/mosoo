import type { AgentChannelBindingProvider } from "@mosoo/contracts/channel";

export type ChannelId = AgentChannelBindingProvider;

export const DISTRIBUTION_CHANNELS: {
  enabled: boolean;
  id: ChannelId;
  label: string;
}[] = [
  { enabled: true, id: "slack", label: "Slack" },
  { enabled: true, id: "lark", label: "Feishu" },
  { enabled: true, id: "discord", label: "Discord" },
  { enabled: true, id: "telegram", label: "Telegram" },
  { enabled: true, id: "wechat", label: "WeChat" },
];

export function downloadTextFile(fileName: string, contentType: string, content: string) {
  const blob = new Blob([content], { type: contentType });
  downloadBlob(fileName, blob);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
