import { Star } from "lucide-react";
import { useInView } from "motion/react";
import { useRef } from "react";
import type { CSSProperties, ReactElement } from "react";

import { GithubMark } from "../github-mark";
import { MOSOO_GITHUB_URL } from "../links";
import { Reveal } from "./motion";
import { Eyebrow, sectionHeadingStyle } from "./ui";
import { UnicornBackground } from "./unicorn";

const CTA_SCENE_ID = "dyB6OzmnClK6iCdmrv2H";

// Light readability scrim over the WebGL — darkest under the centred white text,
// fading to nothing toward the edges so the animation stays clearly visible.
const SCRIM_STYLE = {
  background:
    "radial-gradient(72% 82% at 50% 50%, rgba(8,11,9,0.46) 0%, rgba(8,11,9,0.18) 58%, rgba(8,11,9,0) 100%)",
} satisfies CSSProperties;

export function CtaBand({ onContinue }: { onContinue: () => void }): ReactElement {
  // Mount the scene only as the band nears the viewport, so it initialises on
  // its own — never racing the hero scene's WebGL setup at first paint.
  const panelRef = useRef<HTMLElement>(null);
  const sceneVisible = useInView(panelRef, { once: true, margin: "240px" });

  return (
    <section
      ref={panelRef}
      className="bg-ink-900 relative overflow-hidden px-4 py-16 md:px-6 md:py-20"
    >
      {sceneVisible ? <UnicornBackground projectId={CTA_SCENE_ID} /> : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1]"
        style={SCRIM_STYLE}
      />
      <Reveal className="relative z-10 mx-auto flex max-w-[680px] flex-col items-center text-center">
        <Eyebrow tone="dark">Get started</Eyebrow>
        <h2 className="mt-4 text-white drop-shadow-sm" style={sectionHeadingStyle}>
          Take root in your enterprise.
        </h2>
        <p className="mt-4 max-w-[460px] text-[15px] leading-[1.6] text-white/80">
          Log in to manage your agents, or star the repo and self-host in minutes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onContinue}
            className="focus-visible:ring-paper-100/60 inline-flex h-12 items-center rounded-md bg-[#6FD305] px-7 text-[15px] font-semibold text-[#0F1A02] shadow-sm transition-colors outline-none hover:bg-[#5CB300] focus-visible:ring-2"
          >
            Log in
          </button>
          <a
            href={MOSOO_GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Star Mosoo on GitHub"
            className="text-paper-100 ring-paper-100/25 hover:bg-paper-100/[0.1] focus-visible:ring-paper-100/60 bg-ink-900/30 inline-flex h-12 items-center gap-2 rounded-md px-5 text-[14px] font-semibold ring-1 backdrop-blur-sm transition-colors outline-none focus-visible:ring-2"
          >
            <GithubMark className="size-[18px]" />
            <span>Star on GitHub</span>
            <Star className="size-4" />
          </a>
        </div>
      </Reveal>
    </section>
  );
}
