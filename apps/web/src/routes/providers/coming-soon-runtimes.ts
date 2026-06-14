export interface ComingSoonRuntime {
  label: string;
  provider: string;
  runtimeId: string;
}

export const COMING_SOON_RUNTIMES: ComingSoonRuntime[] = [
  { label: "Pi", provider: "Inflection AI", runtimeId: "pi" },
  { label: "Hermes", provider: "Hermes", runtimeId: "hermes" },
  { label: "OpenClaw", provider: "OpenClaw", runtimeId: "openclaw" },
];
