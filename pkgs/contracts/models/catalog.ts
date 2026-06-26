import type { PresetModelEntry } from "./model-catalog.types";
import { admitModelId, admitProviderId } from "./model-identity";

export const ANTHROPIC_DEFAULT_MODEL_ID = admitModelId("claude-sonnet-4-5");
export const OPENAI_DEFAULT_MODEL_ID = admitModelId("gpt-5.4");

function presetModel(input: {
  displayName: string;
  modelId: string;
  protocol: PresetModelEntry["protocol"];
  vendorId: string;
  vendorLabel: string;
}): PresetModelEntry {
  return {
    displayName: input.displayName,
    modelId: admitModelId(input.modelId),
    protocol: input.protocol,
    vendorId: admitProviderId(input.vendorId),
    vendorLabel: input.vendorLabel,
  };
}

export const PRESET_MODEL_CATALOG = [
  presetModel({
    displayName: "Claude Opus 4.7",
    modelId: "claude-opus-4-7",
    protocol: "anthropic-messages",
    vendorId: "anthropic",
    vendorLabel: "Anthropic",
  }),
  presetModel({
    displayName: "Claude Opus 4.6",
    modelId: "claude-opus-4-6",
    protocol: "anthropic-messages",
    vendorId: "anthropic",
    vendorLabel: "Anthropic",
  }),
  presetModel({
    displayName: "Claude Opus 4.5",
    modelId: "claude-opus-4-5",
    protocol: "anthropic-messages",
    vendorId: "anthropic",
    vendorLabel: "Anthropic",
  }),
  presetModel({
    displayName: "Claude Sonnet 4.6",
    modelId: "claude-sonnet-4-6",
    protocol: "anthropic-messages",
    vendorId: "anthropic",
    vendorLabel: "Anthropic",
  }),
  presetModel({
    displayName: "Claude Sonnet 4.5",
    modelId: "claude-sonnet-4-5",
    protocol: "anthropic-messages",
    vendorId: "anthropic",
    vendorLabel: "Anthropic",
  }),
  presetModel({
    displayName: "Claude Haiku 4.5",
    modelId: "claude-haiku-4-5",
    protocol: "anthropic-messages",
    vendorId: "anthropic",
    vendorLabel: "Anthropic",
  }),
  presetModel({
    displayName: "GPT-5.5",
    modelId: "gpt-5.5",
    protocol: "openai-responses",
    vendorId: "openai",
    vendorLabel: "OpenAI",
  }),
  presetModel({
    displayName: "GPT-5.4",
    modelId: "gpt-5.4",
    protocol: "openai-responses",
    vendorId: "openai",
    vendorLabel: "OpenAI",
  }),
  presetModel({
    displayName: "GPT-5.4 mini",
    modelId: "gpt-5.4-mini",
    protocol: "openai-responses",
    vendorId: "openai",
    vendorLabel: "OpenAI",
  }),
  presetModel({
    displayName: "GPT-5.3",
    modelId: "gpt-5.3",
    protocol: "openai-responses",
    vendorId: "openai",
    vendorLabel: "OpenAI",
  }),
  presetModel({
    displayName: "GPT-5.2",
    modelId: "gpt-5.2",
    protocol: "openai-responses",
    vendorId: "openai",
    vendorLabel: "OpenAI",
  }),
  presetModel({
    displayName: "DeepSeek V4 Pro",
    modelId: "deepseek-v4-pro",
    protocol: "openai-chat-completions",
    vendorId: "opencode",
    vendorLabel: "OpenCode Zen",
  }),
  presetModel({
    displayName: "Qwen3.6 Plus",
    modelId: "qwen3.6-plus",
    protocol: "anthropic-messages",
    vendorId: "opencode",
    vendorLabel: "OpenCode Zen",
  }),
  presetModel({
    displayName: "GLM 5.2",
    modelId: "glm-5.2",
    protocol: "openai-chat-completions",
    vendorId: "opencode",
    vendorLabel: "OpenCode Zen",
  }),
  presetModel({
    displayName: "MiniMax M2.7",
    modelId: "minimax-m2.7",
    protocol: "openai-chat-completions",
    vendorId: "opencode",
    vendorLabel: "OpenCode Zen",
  }),
  presetModel({
    displayName: "Gemini 3.5 Flash",
    modelId: "gemini-3.5-flash",
    protocol: "google-gemini",
    vendorId: "opencode",
    vendorLabel: "OpenCode Zen",
  }),
] as const satisfies readonly PresetModelEntry[];
