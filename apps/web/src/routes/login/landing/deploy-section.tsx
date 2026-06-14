import cloudflareSvgUrl from "@lobehub/icons-static-svg/icons/cloudflare-color.svg";
import { Circle } from "lucide-react";
import type { ReactElement } from "react";

import { MOSOO_DEPLOY_URL } from "../links";
import { Reveal } from "./motion";
import { sectionHeadingStyle } from "./typography";

function CliMock(): ReactElement {
  return (
    <div className="bg-bg-sunken/60 w-full overflow-hidden rounded-[12px] p-4 font-mono text-[12px] leading-[1.85]">
      <p className="text-fg-3"># deploy an agent from the CLI</p>
      <p className="text-fg-2">
        <span className="font-semibold text-[#498C07]">mosoo</span> agents deploy{" "}
        <span className="text-[#3B82A6]">&quot;support-copilot&quot;</span> --source kb_
        <span className="text-[#3B82A6]">8f3a</span>
      </p>
      <p className="text-fg-3">
        → run 4e9c1 · 1,284 docs · 12,480 tokens · <span className="text-[#498C07]">ok</span>
      </p>
    </div>
  );
}

const CONSOLE_ROWS = [
  { name: "Support copilot", state: "live" as const },
  { name: "Contract reviewer", state: "live" as const },
  { name: "IT helpdesk", state: "draft" as const },
];

function WebUiMock(): ReactElement {
  return (
    <div className="bg-bg-sunken/60 w-full overflow-hidden rounded-[12px]">
      <div className="border-border-soft flex items-center gap-1.5 border-b px-3 py-2">
        <span className="bg-ink-200 size-2 rounded-full" />
        <span className="bg-ink-200 size-2 rounded-full" />
        <span className="bg-ink-200 size-2 rounded-full" />
        <span className="text-fg-3 ml-2 text-[11px] font-medium">Agents</span>
      </div>
      <ul className="divide-border-soft divide-y">
        {CONSOLE_ROWS.map((row) => (
          <li key={row.name} className="flex items-center gap-2.5 px-3 py-2">
            <span className="bg-ink-50 border-border-soft size-4 shrink-0 rounded-[4px] border" />
            <span className="text-fg-1 flex-1 truncate text-[12.5px] font-medium">{row.name}</span>
            {row.state === "live" ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#3A6E0E]">
                <Circle className="size-2 fill-current" />
                Live
              </span>
            ) : (
              <span className="text-fg-3 text-[10.5px] font-semibold">Draft</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CloudflareMock(): ReactElement {
  return (
    <div className="flex w-full flex-col items-start gap-3">
      <a
        href={MOSOO_DEPLOY_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="border-border-strong bg-bg-elevated text-fg-1 hover:bg-paper-200 focus-visible:ring-ring inline-flex items-center gap-2.5 rounded-[10px] border px-4 py-2.5 text-[14px] font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2"
      >
        <img src={cloudflareSvgUrl} alt="" className="size-5" />
        Deploy to Cloudflare
      </a>
      <p className="text-fg-3 font-mono text-[11px]">
        provisions Workers · D1 · R2 · KV, no infra to wire up
      </p>
    </div>
  );
}

const CARDS = [
  {
    tag: "CLI",
    visual: <CliMock />,
    title: "Run it from the terminal",
    desc: "Script the whole lifecycle. mosoo agents deploy and it's live: version, publish, roll back from CI.",
  },
  {
    tag: "Web UI",
    visual: <WebUiMock />,
    title: "Or click through the console",
    desc: "Manage agents, spaces, credentials, and cost from a console you can operate, no terminal required.",
  },
  {
    tag: "Self-host",
    visual: <CloudflareMock />,
    title: "Ship to your own Cloudflare",
    desc: "Workers, D1, R2, and KV provision themselves on your account, so prompts and traffic never leave your edge and there is nothing to invoice or operate but your own.",
  },
] as const;

export function DeploySection(): ReactElement {
  return (
    <section className="flex flex-col items-center px-4 pt-20 pb-4 md:px-6 md:pt-24">
      <div className="w-full">
        <Reveal className="max-w-[640px]">
          <h2 className="text-fg-1" style={sectionHeadingStyle}>
            Manage everything from the CLI or the console.
          </h2>
          <p className="text-fg-2 mt-4 text-[15px] leading-[1.6]">
            Spin up, deploy, and run agents from the terminal or the web UI, and self-host the whole
            platform on your own Cloudflare in a single click.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {CARDS.map((card, index) => (
            <Reveal
              key={card.title}
              delay={index * 0.06}
              className="border-border-soft bg-bg-elevated flex flex-col overflow-hidden rounded-[18px] border shadow-[var(--shadow-xs)]"
            >
              <div className="border-border-soft from-paper-200 to-bg-elevated flex h-[180px] items-center border-b bg-gradient-to-b px-5">
                {card.visual}
              </div>
              <div className="p-6">
                <p className="text-fg-3 text-[11px] font-semibold tracking-[0.14em] uppercase">
                  {card.tag}
                </p>
                <h3 className="text-fg-1 mt-2 text-[17px] font-semibold tracking-[-0.01em]">
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
