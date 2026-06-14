import { Coins, Eye, History, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

import { Reveal } from "./motion";
import { sectionHeadingStyle } from "./typography";

type Capability = { Icon: LucideIcon; tag: string; body: string };

const CAPABILITIES: readonly Capability[] = [
  {
    Icon: Eye,
    tag: "Observability",
    body: "A live view of every agent, the sessions invoking it, and the data it touches, updated as runs happen.",
  },
  {
    Icon: ShieldCheck,
    tag: "Control",
    body: "Set who can run which agent against which data, then revoke a key or kill a run the moment you need to.",
  },
  {
    Icon: Coins,
    tag: "Metering",
    body: "Spend rolls up to a app, a user, or a single run, so you can price and bill what you build with receipts.",
  },
  {
    Icon: History,
    tag: "Replay",
    body: "Replay any session from start to finish. When something breaks, reconstruct what happened and trace it to its owner.",
  },
  {
    Icon: Zap,
    tag: "Velocity",
    body: "Wire an agent into your product with one API call, instead of rebuilding the runtime, sandbox, and lifecycle yourself.",
  },
  {
    Icon: TrendingUp,
    tag: "Scale",
    body: "The same API runs 100 sessions today and keeps its guarantees at 100,000 concurrent next year.",
  },
];

export function GovernanceSection(): ReactElement {
  return (
    <section className="flex flex-col items-center px-4 py-20 md:px-6 md:py-24">
      <div className="w-full">
        <Reveal className="flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-fg-1 max-w-[640px]" style={sectionHeadingStyle}>
              Everything you need to run agents in production.
            </h2>
          </div>
          <p className="text-fg-2 max-w-[340px] text-[14px] leading-[1.55]">
            An agent backend isn&apos;t a chatbot. It&apos;s the observability, control, and
            accounting you need to run agents your users depend on.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ Icon, tag, body }, index) => (
            <Reveal
              key={tag}
              delay={index * 0.05}
              className="bg-paper-200/55 flex min-h-[256px] flex-col rounded-[16px] p-6 md:p-7"
            >
              <span className="bg-bg-elevated text-ink-700 inline-flex size-10 items-center justify-center rounded-[12px]">
                <Icon className="size-[19px]" strokeWidth={1.75} />
              </span>
              <div className="mt-auto pt-12">
                <p className="text-fg-3 text-[14px] font-medium">{tag}</p>
                <p className="text-fg-1 mt-2.5 text-[15px] leading-[1.6]">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
