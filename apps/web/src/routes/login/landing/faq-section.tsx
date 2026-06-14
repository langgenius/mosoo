import { Accordion } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import { sectionHeadingStyle } from "./typography";

type Faq = { q: string; a: string };

const FAQS: readonly Faq[] = [
  {
    q: "What is Mosoo?",
    a: "Mosoo is an open-source backend for managed agents — think Supabase, but for cloud agents. It's self-hostable and BYOK, and it turns agents from one-off desktop scripts into deployable, metered, API-callable services you can build products on. It is currently alpha.",
  },
  {
    q: "Who is Mosoo built for?",
    a: "Developers building agent-powered products who don't want to rebuild runtime hosting, sandboxing, and session lifecycle for every app. If you're gluing Claude Code, Codex, or OpenClaw into something your own users depend on, Mosoo is the framework-agnostic backend that handles the plumbing so you ship the product.",
  },
  {
    q: "Why a backend instead of just running Claude Code or Codex locally?",
    a: "For a one-off problem, a local agent or a single Skill is the right, minimal tool — no need to abstract anything. The moment you have to build, evaluate, deploy, and run agents for other people, concurrently and for longer, the tooling fragments and you end up gluing point solutions across the whole lifecycle. Mosoo is the backend that covers that lifecycle, so you build the product instead of the plumbing.",
  },
  {
    q: "Where does my data live, and does Mosoo support BYOK?",
    a: "Mosoo is open source and self-hostable, so data, knowledge, and run history live in infrastructure you control. There's no Mosoo-operated data plane you're forced to route through. It's BYOK: you bring your own model and provider keys, held at the production plane rather than scattered across individual machines and accounts.",
  },
  {
    q: "What happens to an agent once it moves off my laptop?",
    a: "A local agent only reproduces if someone else has your exact files, session history, context, MCP tools, and Skills. Mosoo makes the agent, its Skills, and its Knowledge first-class cloud resources instead of fragments on a personal machine, so a run reproduces from the API rather than a copy of your disk. Mosoo is alpha, so treat fine-grained access and key-rotation flows as still maturing.",
  },
  {
    q: "Which runtimes does Mosoo support, and am I locked to one vendor?",
    a: "In the current alpha the Claude Agent SDK and OpenAI runtime are live, and every harness is normalized to the same interface: streaming, tool calls, native resume, MCP permissions, and session replay. OpenClaw, Hermes, OpenCode, and Gemini are on the roadmap. Because the runtime is a swappable harness, an agent is configured once and resolves a single provider credential at launch, so you can move between vendors without touching the agent definition.",
  },
  {
    q: "When should I use a deterministic workflow versus a general agent?",
    a: "Use a deterministic workflow when the steps are known and you want repeatability; use a general agent when the path is open-ended and you want it to reason its way through. Mosoo's job is to run both behind one production and lifecycle API, rather than forcing every scenario into a single engine.",
  },
  {
    q: "What does the dashboard show me?",
    a: "An agent inventory with lifecycle status, the users and sessions invoking each agent, and cost rolled up by agent, user, and model with token and cache breakdowns and CSV export. These are shipping views, not mockups; fine-grained per-agent ACLs and deeper per-run failure diagnostics are still being filled in during alpha.",
  },
  {
    q: "How do my users reach an agent once it's published?",
    a: "Through whichever surface you bind to it: a typed HTTP API, a /skill in Claude Code, Web Threads, Slack, Lark, GitHub, or your own app. An agent is a managed endpoint, not a single shared link, so you call it where your product already lives.",
  },
  {
    q: "What does a developer configure when building an agent, and how do changes go live?",
    a: "You set the agent's runtime, attach Skills, connect Knowledge, bind Channels, and wire in API integrations, and changes accumulate in a Draft that only takes effect when you publish, so callers always reach a published version rather than in-progress edits. In the current alpha the builder binds existing Skills, MCP servers, and environments; first-class creation of those assets from inside the builder is still being filled in.",
  },
  {
    q: "How is Mosoo different from Dify, n8n, OpenClaw, Claude Code, or building this in-house?",
    a: "Dify and n8n are strong at deterministic workflows; OpenClaw, Claude Code, and Hermes are strong as general agent runtimes. Mosoo doesn't replace them. It sits above them as the backend that runs both kinds as deployable services — with versioning, permissions, sandboxing, and cost handled for you — instead of you rebuilding that plane yourself.",
  },
  {
    q: "What's the license and cost, and is it production-ready?",
    a: "Mosoo is open source, self-hostable, and BYOK, so there's no per-seat fee for running it yourself. It's alpha: the open runtime and lifecycle API work today, but expect rough edges and breaking changes, with the inventory, deploy, and channel surfaces designed to scale from a handful of agents to thousands.",
  },
];

export function FaqSection(): ReactElement {
  return (
    <section className="px-4 py-20 md:px-6 md:py-24">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(220px,0.85fr)_1.9fr] md:gap-16">
        <div>
          <h2 className="text-fg-1" style={sectionHeadingStyle}>
            Frequently asked questions
          </h2>
          <p className="text-fg-2 mt-4 max-w-[280px] text-[14px] leading-[1.6]">
            What developers ask before they build on Mosoo.
          </p>
        </div>

        <div>
          <Accordion.Root className="border-border-soft border-t">
            {FAQS.map((faq) => (
              <Accordion.Item key={faq.q} className="border-border-soft border-b">
                <Accordion.Header>
                  <Accordion.Trigger className="group text-fg-1 focus-visible:ring-ring flex w-full items-center justify-between gap-6 rounded-sm py-5 text-left text-[15.5px] font-medium outline-none focus-visible:ring-2">
                    <span className="flex-1">{faq.q}</span>
                    <ChevronDown className="text-fg-3 size-4 shrink-0 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel className="h-[var(--accordion-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                  <p className="text-fg-2 max-w-[640px] pr-6 pb-5 text-[14.5px] leading-[1.65]">
                    {faq.a}
                  </p>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </div>
      </div>
    </section>
  );
}
