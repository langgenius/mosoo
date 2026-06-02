import { Accordion } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import { sectionHeadingStyle } from "./ui";

type Faq = { q: string; a: string };

const FAQS: readonly Faq[] = [
  {
    q: "What is Mosoo?",
    a: "Mosoo is an open-source enterprise AMS (an Agent Management System) that's self-hostable and BYOK. It turns agents from personal desktop tools into organizational assets that are visible, controllable, accountable, auditable, deployable, and scalable. It is currently alpha.",
  },
  {
    q: "Who is Mosoo built for?",
    a: "Enterprise developers and platform teams who want a self-hosted, governable agent management plane, not consumers looking for another chat shell. If your job is to make agents an accountable organizational asset instead of tools scattered across personal accounts and keys, this is aimed at you.",
  },
  {
    q: "Why does an organization need an AMS instead of another chat shell?",
    a: "Mosoo is a management plane, not a chat UI: chat is one of several consumption surfaces alongside Slack, Lark, GitHub, the API, and internal apps. Once agents enter an enterprise the questions flip from “how do I use this well” to where the data goes, who manages the keys, how billing is aggregated, and who's accountable when an agent acts, and an AMS answers those by managing agents as internal infrastructure in a private Agent Cloud.",
  },
  {
    q: "Where does my data live, and does Mosoo support BYOK?",
    a: "Mosoo is open source and self-hostable, so data, knowledge, and run history live in infrastructure you control. There's no Mosoo-operated data plane you're forced to route through. It's BYOK: you bring your own model and provider keys, held and managed by the enterprise at the production plane rather than scattered across individual employee accounts.",
  },
  {
    q: "What happens to org knowledge when an employee leaves?",
    a: "Because agents, Skills, and Knowledge are organizational assets in the private Agent Cloud rather than personal desktop tools, they stay with the org when someone departs. Mosoo is alpha, so treat fine-grained access revocation and key-rotation flows as still maturing.",
  },
  {
    q: "Which runtimes does Mosoo support, and am I locked to one vendor?",
    a: "In the current alpha the Claude Agent SDK and Codex are live, and every harness is normalized to the same interface: streaming, tool calls, native resume, MCP permissions, and session replay. OpenClaw, Hermes, OpenCode, and Gemini are on the roadmap. Because the runtime is a swappable harness, an agent is configured once and resolves a single provider credential at launch, so you can move between vendors without touching the agent definition.",
  },
  {
    q: "When should I use a deterministic workflow versus a general agent?",
    a: "Use a deterministic workflow when the steps are known and you want repeatability and auditability; use a general agent when the path is open-ended and you want it to reason its way through. The alpha's framing question is how an enterprise unifies both under one production and governance plane, rather than forcing every scenario into a single engine.",
  },
  {
    q: "What does the governance plane show an admin?",
    a: "An agent inventory with lifecycle status, organization members under an owner/admin/member role model, an audit log that distinguishes allowed from denied outcomes with actor and reason, and cost rolled up by agent, user, and model with token and cache breakdowns and CSV export. These are shipping views, not mockups; fine-grained per-agent ACLs and deeper per-run failure diagnostics are still being filled in during alpha.",
  },
  {
    q: "How do employees reach an agent once it's published?",
    a: "Through whichever channels you bind to it: Web Threads, Slack, Lark, GitHub, the API, or your own internal apps. An agent is a managed entry surface, not a single shared link, so people use it where they already work.",
  },
  {
    q: "What does a developer configure when building an agent, and how do changes go live?",
    a: "You set the agent's runtime, attach Skills, connect Knowledge, bind Channels, and wire in API integrations, and changes accumulate in a Draft that only takes effect when you publish, so channels always reach a published version rather than in-progress edits. In the current alpha the builder binds existing Skills, MCP servers, and environments; first-class creation of those assets from inside the builder is still being filled in.",
  },
  {
    q: "How is Mosoo different from Dify, n8n, OpenClaw, Claude Code, or building this in-house?",
    a: "Dify and n8n are strong at deterministic workflows; OpenClaw, Claude Code, and Hermes are strong as general agent runtimes. Mosoo doesn't replace them. It sits above them as a production and governance plane that lets one enterprise run both kinds under unified versioning, permissions, cost, and audit, instead of rebuilding that control plane yourself.",
  },
  {
    q: "What's the license and cost, and is it production-ready?",
    a: "Mosoo is open source, self-hostable, and BYOK, so there's no per-seat fee for running it yourself. It's alpha: the four-plane model and open runtime work today, but expect rough edges and breaking changes, with the inventory, governance, and channel surfaces designed to scale from a handful of agents to thousands.",
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
            What platform teams ask before they put agents into production.
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
