import type { ModelId, ProviderId } from "./model-identity";

export type PresetModelProtocol =
  | "anthropic-messages"
  | "google-gemini"
  | "openai-chat-completions"
  | "openai-responses";

export interface PresetModelEntry {
  displayName: string;
  modelId: ModelId;
  protocol: PresetModelProtocol;
  vendorId: ProviderId;
  vendorLabel: string;
}
