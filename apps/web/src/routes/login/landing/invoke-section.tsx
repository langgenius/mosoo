import { CornerDownLeft } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { ChannelBrandIcon } from "@/shared/ui/channel-brand-icon";
import type { BrandIconKey } from "@/shared/ui/channel-brand-icon";

import { Reveal } from "./motion";
import { DISPLAY_FONT } from "./typography";

const HEADING_STYLE = {
  fontFamily: DISPLAY_FONT,
  fontSize: "clamp(32px, 4vw, 52px)",
  fontWeight: 500,
  letterSpacing: "-0.03em",
  lineHeight: 1.05,
} satisfies CSSProperties;

const GRADIENT_STYLE = {
  backgroundImage: "url(/landing/invoke-gradient.jpg)",
} satisfies CSSProperties;

const SKILLS = [
  { cmd: "/support-agent", desc: "Grounded support" },
  { cmd: "/contract-reviewer", desc: "Legal redlines" },
  { cmd: "/it-helpdesk", desc: "Internal IT" },
] as const;

const CHANNELS: readonly { id: BrandIconKey; name: string }[] = [
  { id: "slack", name: "Slack" },
  { id: "lark", name: "Lark" },
  { id: "discord", name: "Discord" },
  { id: "telegram", name: "Telegram" },
  { id: "wechat", name: "WeChat" },
];

function MockCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <div className={`bg-bg-sunken/60 rounded-[12px] ${className ?? ""}`}>{children}</div>;
}

function SkillMock(): ReactElement {
  return (
    <MockCard className="w-full overflow-hidden">
      <div className="border-border-soft text-fg-3 flex items-center gap-2 border-b px-3 py-2 text-[12px]">
        <span className="bg-bg-sunken text-fg-2 rounded-[4px] px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </span>
        Run an agent skill
      </div>
      <ul className="p-1.5">
        {SKILLS.map((skill, index) => (
          <li
            key={skill.cmd}
            className={`flex items-center gap-2 rounded-[8px] px-2.5 py-2 ${index === 0 ? "bg-bg-sunken" : ""}`}
          >
            <span className="text-fg-1 font-mono text-[12.5px] font-semibold">{skill.cmd}</span>
            <span className="text-fg-3 truncate text-[12px]">{skill.desc}</span>
            {index === 0 ? (
              <CornerDownLeft className="text-fg-3 ml-auto size-3.5 shrink-0" />
            ) : null}
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

function ApiMock(): ReactElement {
  return (
    <MockCard className="w-full overflow-hidden font-mono text-[12px] leading-[1.7]">
      <div className="border-border-soft text-fg-2 border-b px-3.5 py-2.5">
        <span className="font-semibold text-[#498C07]">POST</span> /v1/agents/support-agent/runs
      </div>
      <div className="bg-bg-sunken/50 px-3.5 py-3">
        <p className="text-fg-3">Authorization: Bearer sk_live_…</p>
        <p className="text-fg-2 mt-1.5">
          {"{ "}
          <span className="text-[#3B82A6]">&quot;input&quot;</span>: &quot;Reset my 2FA&quot;{" }"}
        </p>
      </div>
    </MockCard>
  );
}

function ChannelsMock(): ReactElement {
  return (
    <MockCard className="w-full overflow-hidden">
      <ul className="divide-border-soft divide-y">
        {CHANNELS.map((channel) => (
          <li key={channel.id} className="flex items-center gap-2.5 px-3.5 py-2">
            <ChannelBrandIcon channelId={channel.id} className="size-[18px] shrink-0" />
            <span className="text-fg-1 truncate text-[13px] font-medium">{channel.name}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-[5px] bg-[#F4FCE4] px-2 py-0.5 text-[10.5px] font-semibold text-[#3A6E0E]">
              <span className="size-1.5 rounded-full bg-[#5CB300]" />
              Connected
            </span>
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

const CARDS = [
  {
    visual: <SkillMock />,
    title: "Run it as a skill",
    desc: "Invoke a published agent as a /skill inside Claude Code or any compatible CLI: no context-switching, no glue code.",
  },
  {
    visual: <ApiMock />,
    title: "Call it over the API",
    desc: "Every agent gets a typed HTTP endpoint. Wire it into your backend, a cron job, or another agent.",
  },
  {
    visual: <ChannelsMock />,
    title: "Live in your channels",
    desc: "Connect Slack, Lark, Discord, Telegram, or WeChat. Your team talks to the agent without leaving chat.",
  },
] as const;

export function InvokeSection(): ReactElement {
  return (
    <section className="relative overflow-hidden px-4 pt-20 pb-12 md:px-6 md:pt-24">
      {/* Green pixel gradient — fades into the paper canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[460px] bg-cover bg-top"
        style={GRADIENT_STYLE}
      />
      <div
        aria-hidden="true"
        className="to-paper-100 pointer-events-none absolute inset-x-0 top-[300px] -z-0 h-[200px] bg-gradient-to-b from-transparent"
      />

      <div className="relative z-10 mx-auto w-full max-w-[1080px]">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <h2 className="text-fg-1" style={HEADING_STYLE}>
            Publish once.
            <br />
            Call it anywhere.
          </h2>
          <p className="text-fg-2 mt-5 text-[15px] leading-[1.6]">
            A published agent isn&apos;t trapped in a dashboard. Run it as a skill in Claude Code,
            call it over a typed API, or drop it into the chat tools your team already lives in:
            same agent, every surface.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {CARDS.map((card) => (
            <Reveal
              key={card.title}
              className="border-border-soft bg-bg-elevated flex flex-col overflow-hidden rounded-[18px] border shadow-[var(--shadow-xs)]"
            >
              <div className="border-border-soft relative flex h-[190px] items-center overflow-hidden border-b bg-gradient-to-b from-[var(--paper-200)] to-[var(--bg-elevated)] px-5">
                {card.visual}
              </div>
              <div className="p-6">
                <h3 className="text-fg-1 text-[17px] font-semibold tracking-[-0.01em]">
                  {card.title}
                </h3>
                <p className="text-fg-2 mt-2 text-[14px] leading-[1.6]">{card.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
