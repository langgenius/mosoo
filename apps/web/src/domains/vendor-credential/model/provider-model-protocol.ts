import type { PresetModelProtocol } from "@mosoo/contracts/models";

export const CUSTOM_MODEL_PROTOCOL_OPTIONS: readonly {
  label: string;
  value: PresetModelProtocol;
}[] = [
  { label: "OpenAI Chat Completions", value: "openai-chat-completions" },
  { label: "OpenAI Responses", value: "openai-responses" },
  { label: "Anthropic Messages", value: "anthropic-messages" },
  { label: "Google Gemini", value: "google-gemini" },
];

export function modelProtocolLabel(protocol: PresetModelProtocol): string {
  return (
    CUSTOM_MODEL_PROTOCOL_OPTIONS.find((option) => option.value === protocol)?.label ?? protocol
  );
}
