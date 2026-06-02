import { ArrowUpRight, Star } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactElement } from "react";

import { GithubMark } from "../github-mark";
import { MOSOO_API_REFERENCE_URL, MOSOO_GITHUB_URL } from "../links";
import { fadeUp, staggerParent } from "./motion";
import { DISPLAY_FONT, Eyebrow } from "./ui";
import { UnicornBackground } from "./unicorn";

const HERO_SCENE_ID = "RasGv747UbFbFukg0cwh";

const HERO_PANEL_STYLE = {
  backgroundColor: "var(--paper-100)",
} satisfies CSSProperties;

const HERO_HEADLINE_STYLE = {
  fontFamily: DISPLAY_FONT,
  fontSize: "clamp(44px, 6.4vw, 84px)",
  fontWeight: 500,
  letterSpacing: "-0.035em",
  lineHeight: 1.02,
} satisfies CSSProperties;

const HERO_SUBHEAD_STYLE = {
  fontSize: "clamp(15px, 1.4vw, 17px)",
  lineHeight: 1.55,
} satisfies CSSProperties;

export function Hero({ onContinue }: { onContinue: () => void }): ReactElement {
  const reduceMotion = useReducedMotion();

  return (
    <section
      className="relative flex min-h-[640px] flex-col items-center justify-center overflow-hidden px-4 py-20 md:min-h-[680px] md:px-6 md:py-24"
      style={HERO_PANEL_STYLE}
    >
      {/* WebGL aurora — the brand's signature hero motion */}
      <UnicornBackground projectId={HERO_SCENE_ID} />

      <motion.div
        className="relative z-10 flex w-full max-w-[1080px] flex-col items-center text-center"
        initial={reduceMotion ? false : "hidden"}
        animate="visible"
        variants={staggerParent}
      >
        <motion.div variants={fadeUp}>
          <Eyebrow>Open source · Managed agents</Eyebrow>
        </motion.div>
        <motion.h1
          className="text-ink-900 mt-7 [text-wrap:balance]"
          style={HERO_HEADLINE_STYLE}
          variants={fadeUp}
        >
          <span className="block">Managed agents,</span>
          <span className="block">built open source.</span>
        </motion.h1>
        <motion.p
          className="text-ink-800 mt-6 max-w-[640px]"
          style={HERO_SUBHEAD_STYLE}
          variants={fadeUp}
        >
          One control plane for Codex, Claude Code, OpenClaw, and Hermes Agent. Runtime-agnostic
          agents your enterprise can actually govern.
        </motion.p>
        <motion.div
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
          variants={fadeUp}
        >
          <button
            type="button"
            onClick={onContinue}
            className="bg-ink-900 text-paper-100 hover:bg-ink-800 focus-visible:ring-ring inline-flex h-12 items-center rounded-md px-7 text-[15px] font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2"
          >
            Log in
          </button>
          <a
            href={MOSOO_GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Star Mosoo on GitHub"
            className="text-ink-900 ring-ink-900/15 hover:bg-ink-900/[0.06] focus-visible:ring-ring inline-flex h-12 items-center gap-2 rounded-md px-5 text-[14px] font-semibold ring-1 transition-colors outline-none focus-visible:ring-2"
          >
            <GithubMark className="size-[18px]" />
            <span>Star on GitHub</span>
            <Star className="size-4" />
          </a>
          <a
            href={MOSOO_API_REFERENCE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-900 hover:text-ink-900 focus-visible:ring-ring inline-flex h-12 items-center gap-1.5 rounded-md px-3 text-[14px] font-semibold transition-colors outline-none focus-visible:ring-2"
          >
            <span>API reference</span>
            <ArrowUpRight className="size-4" />
          </a>
        </motion.div>
        <motion.p
          className="text-ink-700 mt-6 font-mono text-[11px] tracking-[0.18em] uppercase"
          variants={fadeUp}
        >
          Open source · Self-hostable · BYOK
        </motion.p>
      </motion.div>
    </section>
  );
}
