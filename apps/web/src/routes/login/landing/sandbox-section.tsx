import { Circle } from "lucide-react";
import type { ReactElement } from "react";

import { RuntimeIcon } from "@/shared/ui/brand-icons";

import { Reveal } from "./motion";
import { sectionHeadingStyle } from "./typography";

// A static recreation of the live sandbox shell — styled after the app's
// Owner Debug Terminal, but it tells the "spin up on demand" story instead of
// connecting to a real socket.
function SandboxTerminal(): ReactElement {
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/10 bg-[#0e1014] shadow-[0_12px_28px_-12px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-white p-0.5">
            <RuntimeIcon runtimeId="claude-agent-sdk" className="size-full" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-white">Agent sandbox</p>
            <p className="truncate font-mono text-[10px] text-white/45">
              claude-agent-sdk · ephemeral
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] font-medium text-emerald-300">
          <Circle className="size-2 fill-current" />
          mounted
        </span>
      </div>

      <div className="min-h-[300px] bg-[#090b0f] p-4 font-mono text-[12px] leading-[1.85]">
        <p className="text-white/80">
          <span className="text-emerald-300">$</span> mosoo run support-agent --runtime
          claude-agent-sdk
        </p>
        <p className="text-white/45">▸ mounting sandbox 27fe1193af5a …</p>
        <p className="text-white/80">
          <span className="text-emerald-300">✓</span> sandbox ready in 0.4s · /workspace mounted
        </p>
        <p className="text-white/45">▸ pulling runtime · Claude Agent SDK</p>
        <p className="text-white/80">
          <span className="text-emerald-300">✓</span> runtime online · claude-opus-4.8 · streaming +
          tools
        </p>
        <p className="text-white/45">▸ mounting Spaces · support-kb, runbooks (ro)</p>
        <p className="text-white/80">
          <span className="text-emerald-300">✓</span> 12 MCP tools · BYOK credentials resolved
        </p>
        <p className="text-white/45">▸ booting agent · memory + context restored</p>
        <p className="text-white/80">
          <span className="text-emerald-300">✓</span> support-agent live · full cloud agent ready
        </p>
        <p className="flex items-center text-white/55">
          root@27fe1193af5a:/workspace#
          <span className="ml-1.5 inline-block h-[14px] w-[7px] animate-pulse bg-emerald-300" />
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 bg-black/30 px-4 py-1.5 font-mono text-[10px] text-white/40">
        <span>agent · support-agent</span>
        <span>ephemeral sandbox</span>
      </div>
    </div>
  );
}

export function SandboxSection(): ReactElement {
  return (
    <section className="px-4 py-20 md:px-6 md:py-24">
      <div className="grid items-stretch gap-10 md:grid-cols-2 md:gap-14">
        {/* Left — message + Claude Code badge + the sandbox terminal */}
        <Reveal className="flex flex-col">
          <h2 className="text-fg-1" style={sectionHeadingStyle}>
            No always-on agent cloud.
          </h2>
          <p className="text-fg-2 mt-4 max-w-[480px] text-[15px] leading-[1.6]">
            Mosoo mounts a fresh sandbox the instant an agent runs, then tears it down when the turn
            ends. No standing fleet humming inside your enterprise: compute appears on demand,
            scoped to the session, and disappears.
          </p>
          <span className="border-border-soft bg-bg-elevated mt-6 inline-flex w-fit items-center gap-2 rounded-[8px] border px-3 py-1.5">
            <RuntimeIcon runtimeId="claude-agent-sdk" className="size-4" />
            <span className="text-fg-2 text-[12.5px] font-medium">Runs on Claude Code</span>
          </span>
          <div className="mt-8">
            <SandboxTerminal />
          </div>
        </Reveal>

        {/* Right — the bamboo image (paired beside the component) */}
        <Reveal delay={0.08} className="md:h-full">
          <img
            src="/landing/bamboo-sky.jpg"
            alt="Pixel-art bamboo reaching into a bright sky"
            className="h-[300px] w-full rounded-[18px] object-cover md:h-full"
          />
        </Reveal>
      </div>
    </section>
  );
}
