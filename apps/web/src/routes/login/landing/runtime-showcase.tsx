import { Check, Clock } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { RuntimeIcon } from "@/shared/ui/brand-icons";

import { Reveal } from "./motion";
import { EASE_OUT } from "./motion-variants";
import { sectionHeadingStyle } from "./typography";

type Runtime = {
  runtimeId: string;
  label: string;
  provider: string;
  available: boolean;
};

// The agent drivers (harnesses) a Mosoo agent can run on — runtime ids match the
// brand-icon catalog. Status mirrors the live runtime availability.
const RUNTIMES: readonly Runtime[] = [
  {
    runtimeId: "claude-agent-sdk",
    label: "Claude Agent SDK",
    provider: "Anthropic",
    available: true,
  },
  { runtimeId: "openai-runtime", label: "OpenAI", provider: "OpenAI", available: true },
  { runtimeId: "opencode", label: "OpenCode", provider: "sst", available: false },
  { runtimeId: "openclaw", label: "OpenClaw", provider: "OpenClaw", available: false },
  { runtimeId: "hermes", label: "Hermes", provider: "Hermes", available: false },
  { runtimeId: "gemini", label: "Gemini", provider: "Google", available: false },
  { runtimeId: "pi", label: "Pi", provider: "Inflection AI", available: false },
  { runtimeId: "cursor-agent", label: "Cursor Agent", provider: "Cursor", available: false },
];

// Mosoo normalises every harness to the same interface — so the capability set is
// identical no matter which runtime you pick. That sameness is the whole point.
const CAPABILITIES = [
  "Streaming + tool calls",
  "Native resume",
  "MCP tools & permissions",
  "Session replay",
] as const;

function CheckDot(): ReactElement {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
      <Check className="size-2.5" strokeWidth={3} />
    </span>
  );
}

function RuntimeCard({ runtime }: { runtime: Runtime }): ReactElement {
  return (
    <div className="border-border-soft bg-bg-elevated rounded-[18px] border p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="border-border-soft flex size-10 items-center justify-center rounded-[10px] border bg-white">
          <RuntimeIcon runtimeId={runtime.runtimeId} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-fg-1 text-[15px] font-semibold tracking-[-0.01em]">{runtime.label}</p>
          <p className="text-fg-3 text-[12.5px]">{runtime.provider}</p>
        </div>
        {runtime.available ? (
          <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-800">
            <span className="size-1.5 rounded-full bg-green-600" />
            Available
          </span>
        ) : (
          <span className="bg-bg-sunken text-fg-3 inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-semibold">
            <Clock className="size-3" />
            Coming soon
          </span>
        )}
      </div>

      <div className="border-border-soft text-fg-2 mt-4 flex items-center gap-2 border-t pt-4 text-[13px]">
        <CheckDot />
        <span>Resolves one Provider credential at launch</span>
      </div>

      <div className="border-border-soft bg-bg-sunken mt-3 rounded-[12px] border p-3.5">
        <p className="text-fg-3 text-[11px] font-semibold tracking-[0.08em] uppercase">
          Normalized interface
        </p>
        <ul className="mt-2.5 flex flex-col gap-2">
          {CAPABILITIES.map((capability) => (
            <li key={capability} className="text-fg-2 flex items-center gap-2.5 text-[13px]">
              <CheckDot />
              {capability}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function RuntimeShowcase(): ReactElement | null {
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();
  const current = RUNTIMES[active];

  if (!current) {
    return null;
  }

  return (
    <section className="flex flex-col items-center px-4 py-20 md:px-6 md:py-24">
      <div className="grid w-full items-center gap-10 md:grid-cols-2 md:gap-14">
        {/* Left — copy + selectable runtime row */}
        <Reveal>
          <h2 className="text-fg-1" style={sectionHeadingStyle}>
            One Agent. Any runtime.
          </h2>
          <p className="text-fg-2 mt-4 max-w-[480px] text-[15px] leading-[1.6]">
            A Mosoo agent is harness-neutral. Configure it once, then run it on the Claude Agent SDK
            or any driver: the runtime is a swappable harness, not a rewrite. Same interface, same
            session model, every time.
          </p>

          <p className="text-fg-3 mt-8 text-[11px] font-semibold tracking-[0.14em] uppercase">
            Agent runtimes
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {RUNTIMES.map((runtime, index) => {
              const isActive = index === active;
              return (
                <button
                  key={runtime.runtimeId}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onClick={() => setActive(index)}
                  aria-label={`Preview ${runtime.label}`}
                  aria-pressed={isActive}
                  className={cn(
                    "focus-visible:ring-ring flex size-12 items-center justify-center rounded-[12px] border bg-white outline-none transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2",
                    isActive
                      ? "border-border-strong scale-[1.06] shadow-md"
                      : "border-border-soft opacity-55 grayscale hover:opacity-100 hover:grayscale-0",
                  )}
                >
                  <RuntimeIcon runtimeId={runtime.runtimeId} className="size-7" />
                </button>
              );
            })}
          </div>
        </Reveal>

        {/* Right — the card carousels to the hovered runtime */}
        <Reveal delay={0.08} className="md:pl-4">
          <div className="relative min-h-[284px]">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={current.runtimeId}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
              >
                <RuntimeCard runtime={current} />
              </m.div>
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
