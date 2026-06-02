export interface ComingSoonRuntime {
  label: string;
  provider: string;
  runtimeId: string;
}

export const COMING_SOON_RUNTIMES: ComingSoonRuntime[] = [
  { label: "OpenCode", provider: "sst", runtimeId: "opencode" },
  { label: "OpenClaw", provider: "OpenClaw", runtimeId: "openclaw" },
  { label: "Hermes", provider: "Hermes", runtimeId: "hermes" },
  { label: "Gemini", provider: "Google", runtimeId: "gemini" },
  { label: "Pi", provider: "Inflection AI", runtimeId: "pi" },
  { label: "Cursor Agent", provider: "Cursor", runtimeId: "cursor-agent" },
];
