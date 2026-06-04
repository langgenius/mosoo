import { Tabs } from "@base-ui/react/tabs";
import Avatar from "boring-avatars";
import { Activity, Coins, Download, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

import { Reveal } from "./motion";
import { sectionHeadingStyle } from "./typography";

// Brighter, higher-saturation avatar palette (lime brand scale + accents).
const AVATAR_COLORS = ["#5CB300", "#3B9AE1", "#E8A22E", "#7A5230", "#95DD2C"];
const MODEL_DONUT_TRACK_STYLE = { stroke: "var(--ink-100)" } satisfies CSSProperties;

type Kpi = {
  label: string;
  value: string;
  delta?: string;
  down?: boolean;
  sub?: string;
  Icon: LucideIcon;
};

const KPIS: readonly Kpi[] = [
  { label: "Total spend", value: "US$4.82K", delta: "−12.3%", down: true, Icon: Wallet },
  { label: "Requests", value: "18.9K", delta: "+8.1%", down: false, Icon: Activity },
  { label: "Tokens", value: "142M", sub: "94% cache hit", Icon: Coins },
  { label: "Active members", value: "27", sub: "of 31", Icon: Users },
];

const SPEND_TREND = [
  { month: "Jan", prod: 58, debug: 22 },
  { month: "Feb", prod: 74, debug: 40 },
  { month: "Mar", prod: 64, debug: 28 },
  { month: "Apr", prod: 90, debug: 48 },
  { month: "May", prod: 50, debug: 20 },
  { month: "Jun", prod: 72, debug: 34 },
] as const;

type ModelRow = {
  name: string;
  vendor: string;
  color: string;
  pct: number;
  tokens: string;
  cache: string;
  cost: string;
};

const MODELS: readonly ModelRow[] = [
  {
    name: "Claude Opus 4.7",
    vendor: "Anthropic",
    color: "#5CB300",
    pct: 48,
    tokens: "58M",
    cache: "96%",
    cost: "US$2.31K",
  },
  {
    name: "Claude Sonnet 4.6",
    vendor: "Anthropic",
    color: "#95DD2C",
    pct: 25,
    tokens: "44M",
    cache: "92%",
    cost: "US$1.21K",
  },
  {
    name: "GPT-5.4",
    vendor: "OpenAI",
    color: "#828A93",
    pct: 16,
    tokens: "22M",
    cache: "88%",
    cost: "US$0.77K",
  },
  {
    name: "Gemini 2.5 Pro",
    vendor: "Google",
    color: "#3B9AE1",
    pct: 7,
    tokens: "12M",
    cache: "90%",
    cost: "US$0.34K",
  },
  {
    name: "Qwen3-Max",
    vendor: "Alibaba",
    color: "#E8A22E",
    pct: 4,
    tokens: "6M",
    cache: "85%",
    cost: "US$0.19K",
  },
];

type MixPart = { className: string; pct: number };

type AgentRow = {
  name: string;
  owner: string;
  mix: readonly MixPart[];
  delta: number;
  requests: string;
  cost: string;
  share: string;
};

const AGENTS: readonly AgentRow[] = [
  {
    name: "Support copilot",
    owner: "Rina Kato",
    mix: [
      { className: "bg-[#6FD305]", pct: 76 },
      { className: "bg-[#B6E85F]", pct: 16 },
      { className: "bg-ink-300", pct: 8 },
    ],
    delta: -6.2,
    requests: "6.2K",
    cost: "US$1.84K",
    share: "38%",
  },
  {
    name: "Contract reviewer",
    owner: "Amir Shah",
    mix: [
      { className: "bg-[#6FD305]", pct: 54 },
      { className: "bg-[#B6E85F]", pct: 38 },
      { className: "bg-ink-300", pct: 8 },
    ],
    delta: 14.0,
    requests: "1.1K",
    cost: "US$1.12K",
    share: "23%",
  },
  {
    name: "IT helpdesk",
    owner: "Lena Ortiz",
    mix: [
      { className: "bg-[#6FD305]", pct: 88 },
      { className: "bg-[#B6E85F]", pct: 7 },
      { className: "bg-ink-300", pct: 5 },
    ],
    delta: -2.1,
    requests: "3.4K",
    cost: "US$0.86K",
    share: "18%",
  },
  {
    name: "Sales researcher",
    owner: "Tom Vogel",
    mix: [
      { className: "bg-[#6FD305]", pct: 61 },
      { className: "bg-[#B6E85F]", pct: 24 },
      { className: "bg-ink-300", pct: 15 },
    ],
    delta: 3.4,
    requests: "0.9K",
    cost: "US$0.62K",
    share: "13%",
  },
  {
    name: "Onboarding bot",
    owner: "Priya Nair",
    mix: [
      { className: "bg-[#6FD305]", pct: 80 },
      { className: "bg-[#B6E85F]", pct: 12 },
      { className: "bg-ink-300", pct: 8 },
    ],
    delta: -9.0,
    requests: "2.0K",
    cost: "US$0.38K",
    share: "8%",
  },
];

type MemberRow = {
  name: string;
  dept: string;
  topAgent: string;
  agents: number;
  cost: string;
  share: string;
};

const MEMBERS: readonly MemberRow[] = [
  {
    name: "Rina Kato",
    dept: "Platform Eng",
    topAgent: "Support copilot",
    agents: 8,
    cost: "US$1.46K",
    share: "30%",
  },
  {
    name: "Amir Shah",
    dept: "Legal",
    topAgent: "Contract reviewer",
    agents: 3,
    cost: "US$0.98K",
    share: "20%",
  },
  {
    name: "Lena Ortiz",
    dept: "IT",
    topAgent: "IT helpdesk",
    agents: 5,
    cost: "US$0.74K",
    share: "15%",
  },
  {
    name: "Tom Vogel",
    dept: "Sales",
    topAgent: "Sales researcher",
    agents: 4,
    cost: "US$0.55K",
    share: "11%",
  },
  {
    name: "Priya Nair",
    dept: "Customer Success",
    topAgent: "Onboarding bot",
    agents: 6,
    cost: "US$0.49K",
    share: "10%",
  },
];

const TABS = [
  { value: "agent", label: "By Agent" },
  { value: "member", label: "By Member" },
  { value: "model", label: "By Model" },
] as const;

const RUN_MIX_LEGEND = [
  { className: "bg-[#6FD305]", label: "Production" },
  { className: "bg-[#B6E85F]", label: "Debug" },
  { className: "bg-ink-300", label: "Preview" },
] as const;

function Card({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <div
      className={cn(
        "border-border-soft bg-bg-elevated rounded-[16px] border shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Delta({ value }: { value: number }): ReactElement {
  return (
    <span
      className={cn("font-mono text-[12.5px]", value > 0 ? "text-amber-700" : "text-[#3A6E0E]")}
    >
      {value > 0 ? "+" : "−"}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function CostCell({ value, share }: { value: string; share: string }): ReactElement {
  return (
    <div className="text-right">
      <div className="text-fg-1 font-mono text-[13px] font-semibold">{value}</div>
      <div className="text-fg-3 text-[11.5px]">{share}</div>
    </div>
  );
}

function HeadCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn("text-fg-3 text-[10.5px] font-semibold tracking-[0.1em] uppercase", className)}
    >
      {children}
    </div>
  );
}

function MemberAvatar({ name }: { name: string }): ReactElement {
  return (
    <span className="shrink-0 overflow-hidden rounded-full">
      <Avatar name={name} variant="beam" size={28} colors={AVATAR_COLORS} />
    </span>
  );
}

function SpendChart(): ReactElement {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-fg-1 text-[14px] font-semibold">Spend over time</p>
          <p className="text-fg-3 mt-0.5 text-[12px]">Production vs debug · last 6 months</p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px]">
          <span className="text-fg-2 inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-[#6FD305]" />
            Production
          </span>
          <span className="text-fg-2 inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-[#B6E85F]" />
            Debug
          </span>
        </div>
      </div>
      <div className="relative mt-6 h-[180px]">
        <div className="absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className="border-border-soft/70 border-t" />
          ))}
        </div>
        <div className="relative flex h-full items-end gap-3 sm:gap-5">
          {SPEND_TREND.map((point) => (
            <div key={point.month} className="flex h-full flex-1 flex-col items-center justify-end">
              <div className="flex h-full w-full items-end justify-center gap-1.5">
                <span
                  className="w-[38%] rounded-t-[3px] bg-[#6FD305]"
                  style={{ height: `${point.prod}%` }}
                />
                <span
                  className="w-[38%] rounded-t-[3px] bg-[#B6E85F]"
                  style={{ height: `${point.debug}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-3 sm:gap-5">
        {SPEND_TREND.map((point) => (
          <span key={point.month} className="text-fg-2 flex-1 text-center text-[11px]">
            {point.month}
          </span>
        ))}
      </div>
    </Card>
  );
}

function ModelDonut(): ReactElement {
  let cumulative = 0;

  return (
    <Card className="flex flex-col p-5">
      <p className="text-fg-1 text-[14px] font-semibold">Spend by model</p>
      <p className="text-fg-3 mt-0.5 text-[12px]">Where the budget goes</p>
      <div className="mt-4 flex items-center gap-5">
        <div className="relative size-[128px] shrink-0">
          <svg viewBox="0 0 36 36" className="size-full -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              strokeWidth="3.4"
              style={MODEL_DONUT_TRACK_STYLE}
            />
            {MODELS.map((model) => {
              const segment = (
                <circle
                  key={model.name}
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="none"
                  strokeWidth="3.4"
                  strokeDasharray={`${model.pct} ${100 - model.pct}`}
                  strokeDashoffset={-cumulative}
                  style={{ stroke: model.color }}
                />
              );
              cumulative += model.pct;
              return segment;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-fg-1 text-[16px] font-semibold tracking-[-0.02em]">US$4.82K</span>
            <span className="text-fg-2 text-[10.5px]">30 days</span>
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-2">
          {MODELS.map((model) => (
            <li key={model.name} className="flex items-center gap-2 text-[12.5px]">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: model.color }}
              />
              <span className="text-fg-2 min-w-0 flex-1 truncate">{model.name}</span>
              <span className="text-fg-2 font-mono">{model.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

const TABLE_SHELL = "min-w-[660px]";

export function CostSection(): ReactElement {
  return (
    <section className="flex flex-col px-4 py-20 md:px-6 md:py-24">
      <Reveal className="max-w-[620px]">
        <h2 className="text-fg-1" style={sectionHeadingStyle}>
          Account every dollar to a name.
        </h2>
        <p className="text-fg-2 mt-4 text-[15px] leading-[1.6]">
          See exactly where spend goes: by agent, by member, by model. Roll cost up to a team or a
          person, compare against last period, and prove the ROI of every agent you ship.
        </p>
      </Reveal>

      <Reveal delay={0.08} className="mt-10 flex flex-col gap-3">
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {KPIS.map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-fg-3 text-[12px] font-medium">{kpi.label}</p>
                  <p className="text-fg-1 mt-2 text-[23px] font-semibold tracking-[-0.02em]">
                    {kpi.value}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {kpi.delta ? (
                      <span
                        className={cn(
                          "font-mono text-[12px]",
                          kpi.down ? "text-[#3A6E0E]" : "text-amber-700",
                        )}
                      >
                        {kpi.delta}
                      </span>
                    ) : null}
                    {kpi.sub ? <span className="text-fg-3 text-[11.5px]">{kpi.sub}</span> : null}
                  </div>
                </div>
                <div className="bg-ink-50 text-ink-700 border-border-soft flex size-9 shrink-0 items-center justify-center rounded-[10px] border">
                  <kpi.Icon className="size-[18px]" />
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.55fr_1fr]">
          <SpendChart />
          <ModelDonut />
        </div>

        {/* Tabbed breakdown */}
        <Card className="overflow-hidden">
          <div className="border-border-soft flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
            <div>
              <p className="text-fg-1 text-[15px] font-semibold tracking-[-0.01em]">Breakdown</p>
              <p className="text-fg-3 text-[12px]">
                Pivot the same spend by agent, member, or model
              </p>
            </div>
            <span className="border-border-soft text-fg-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium">
              <Download className="size-3.5" />
              Export CSV
            </span>
          </div>

          <Tabs.Root defaultValue="agent">
            <Tabs.List className="border-border-soft flex gap-1 border-b px-3">
              {TABS.map((tab) => (
                <Tabs.Tab
                  key={tab.value}
                  value={tab.value}
                  className="text-fg-3 data-[selected]:text-fg-1 data-[selected]:border-ink-900 focus-visible:ring-ring -mb-px cursor-pointer rounded-t-sm border-b-2 border-transparent px-3 py-2.5 text-[13px] font-semibold outline-none focus-visible:ring-2"
                >
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>

            {/* By Agent */}
            <Tabs.Panel value="agent" className="overflow-x-auto">
              <div className={TABLE_SHELL}>
                <div className="border-border-soft grid grid-cols-[1.4fr_1fr_120px_90px_90px_110px] items-center gap-3 border-b px-5 py-2.5">
                  <HeadCell>Agent</HeadCell>
                  <HeadCell>Owner</HeadCell>
                  <HeadCell>Run mix</HeadCell>
                  <HeadCell>vs. prev</HeadCell>
                  <HeadCell>Requests</HeadCell>
                  <HeadCell className="text-right">Cost</HeadCell>
                </div>
                {AGENTS.map((agent) => (
                  <div
                    key={agent.name}
                    className="border-border-soft hover:bg-bg-sunken/50 grid grid-cols-[1.4fr_1fr_120px_90px_90px_110px] items-center gap-3 border-b px-5 py-3 transition-colors last:border-b-0"
                  >
                    <div className="text-fg-1 truncate text-[13.5px] font-semibold">
                      {agent.name}
                    </div>
                    <div className="text-fg-2 truncate text-[13px]">{agent.owner}</div>
                    <div className="bg-bg-sunken flex h-2 w-full max-w-[120px] overflow-hidden rounded-full">
                      {agent.mix.map((part) => (
                        <span
                          key={part.className}
                          className={part.className}
                          style={{ width: `${part.pct}%` }}
                        />
                      ))}
                    </div>
                    <Delta value={agent.delta} />
                    <div className="text-fg-2 text-[13px]">{agent.requests}</div>
                    <CostCell value={agent.cost} share={agent.share} />
                  </div>
                ))}
                <div className="text-fg-3 flex flex-wrap items-center gap-4 px-5 py-3 text-[11.5px]">
                  {RUN_MIX_LEGEND.map((item) => (
                    <span key={item.label} className="inline-flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-[2px]", item.className)} />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            </Tabs.Panel>

            {/* By Member */}
            <Tabs.Panel value="member" className="overflow-x-auto">
              <div className={TABLE_SHELL}>
                <div className="border-border-soft grid grid-cols-[1.6fr_1fr_1.2fr_80px_110px] items-center gap-3 border-b px-5 py-2.5">
                  <HeadCell>Member</HeadCell>
                  <HeadCell>Department</HeadCell>
                  <HeadCell>Top agent</HeadCell>
                  <HeadCell>Agents</HeadCell>
                  <HeadCell className="text-right">Cost</HeadCell>
                </div>
                {MEMBERS.map((member) => (
                  <div
                    key={member.name}
                    className="border-border-soft hover:bg-bg-sunken/50 grid grid-cols-[1.6fr_1fr_1.2fr_80px_110px] items-center gap-3 border-b px-5 py-3 transition-colors"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <MemberAvatar name={member.name} />
                      <span className="text-fg-1 truncate text-[13.5px] font-semibold">
                        {member.name}
                      </span>
                    </div>
                    <div>
                      <span className="bg-bg-sunken text-fg-2 inline-flex max-w-full truncate rounded-[5px] px-2 py-0.5 text-[11.5px] font-medium">
                        {member.dept}
                      </span>
                    </div>
                    <div className="text-fg-2 truncate text-[13px]">{member.topAgent}</div>
                    <div className="text-fg-2 text-[13px]">{member.agents}</div>
                    <CostCell value={member.cost} share={member.share} />
                  </div>
                ))}
                <div className="bg-bg-sunken/40 text-fg-3 grid grid-cols-[1.6fr_1fr_1.2fr_80px_110px] items-center gap-3 px-5 py-3 text-[12.5px]">
                  <div className="col-span-4">External · channel-triggered</div>
                  <div className="text-right">
                    <span className="text-fg-2 font-mono text-[13px] font-semibold">US$0.41K</span>
                    <span className="text-fg-3 ml-1.5 text-[11.5px]">9%</span>
                  </div>
                </div>
              </div>
            </Tabs.Panel>

            {/* By Model */}
            <Tabs.Panel value="model" className="overflow-x-auto">
              <div className={TABLE_SHELL}>
                <div className="border-border-soft grid grid-cols-[1.4fr_1fr_90px_90px_110px] items-center gap-3 border-b px-5 py-2.5">
                  <HeadCell>Model</HeadCell>
                  <HeadCell>Vendor</HeadCell>
                  <HeadCell>Tokens</HeadCell>
                  <HeadCell>Cache hit</HeadCell>
                  <HeadCell className="text-right">Cost</HeadCell>
                </div>
                {MODELS.map((model) => (
                  <div
                    key={model.name}
                    className="border-border-soft hover:bg-bg-sunken/50 grid grid-cols-[1.4fr_1fr_90px_90px_110px] items-center gap-3 border-b px-5 py-3 transition-colors last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: model.color }}
                      />
                      <span className="text-fg-1 truncate text-[13.5px] font-semibold">
                        {model.name}
                      </span>
                    </div>
                    <div className="text-fg-2 truncate text-[13px]">{model.vendor}</div>
                    <div className="text-fg-2 text-[13px]">{model.tokens}</div>
                    <div className="text-fg-2 text-[13px]">{model.cache}</div>
                    <CostCell value={model.cost} share={`${model.pct}%`} />
                  </div>
                ))}
              </div>
            </Tabs.Panel>
          </Tabs.Root>

          <div className="border-border-soft text-fg-3 border-t px-5 py-3 font-mono text-[11px]">
            billable_input = max(0, input − cache_read)
          </div>
        </Card>
      </Reveal>
    </section>
  );
}
