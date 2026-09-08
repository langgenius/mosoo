# Product

## Register

product

## Users

Personal / OPC developers and small self-hosted deployments running a Cloudflare-native
Agent Cloud. They are technical: they configure runtimes, providers, MCP servers, and
skills, dispatch agents into sandboxes, and watch cost and runtime state. On any given
screen they are in a configuration or monitoring task, not browsing. Familiarity with
tools like GitHub, Linear, and Vercel is assumed; the UI should feel native to that crowd.

## Product Purpose

mosoo is an open-source Agent Cloud. It lets developers deploy, configure, run,
and debug agents through OpenAI runtime, Claude Agent SDK, and OpenCode/DeepSeek
via ACP in isolated sandboxes, then ship them to users. The current Web console is organized as
Project Overview / Runs / Agents / Config, plus account Settings; Project Usage lives in Project
Settings. Environment, Skills, MCP, and Providers are configuration
surfaces. Organization Usage/Billing governance remains a visible `Soon` surface,
not a shipped console capability. Public landing and blog content live in
`langgenius/mosoo-website`.

## Brand Personality

Three words: precise, developer-native, restrained. Voice is plain and concrete: say
what the product literally does, no marketing buzzwords. The Moso-bamboo green is a
disciplined accent (growth/action), not a wash; the UI is neutral-first and calm, in
the way Supabase's and Mintlify's product shells are. Confidence through clarity, not
decoration.

## Anti-references

- Marketing-template console pages that trade task density for decorative hero metrics.
- Heavy enterprise dashboards drowning in chrome, modals-first flows, and decorative
  motion.
- Over-rounded, glassmorphic, shadow-heavy "AI startup" component kits.

## Design Principles

1. **Neutral-first, green as punctuation.** Pure neutral grays carry the UI; the brand
   green marks the one focal action per surface, keyboard focus, checked controls, and
   a few live markers. Selection stays neutral and feedback states use their own hues
   (see `docs/design/theme-color-usage.md`).
2. **Earned familiarity.** Standard affordances (top/side nav, tabs, command-style
   inputs) so the tool disappears into the task. No reinvented controls.
3. **Consistency over surprise.** One button vocabulary, one form vocabulary, one
   empty-state vocabulary, one capitalization rule, screen to screen.
4. **Say what it does.** Copy names a concrete noun and verb. No staccato slogans, no
   buzzwords, no em dashes.
5. **Every state designed.** default / hover / focus / active / disabled / loading /
   empty / error for each surface, not half of them.

## Accessibility & Inclusion

Target WCAG AA. Body text ≥4.5:1, large/UI text ≥3:1, including placeholders and muted
copy on tinted surfaces. Visible focus rings on every interactive element. Honor
`prefers-reduced-motion` for new motion work. Every state is distinguishable without
colour alone (glyphs, underlines, rings, surface changes). A dark token palette exists
and is captured in the design-contract E2E case, but a user-selectable dark theme is
not currently shipped.
