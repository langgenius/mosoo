import { useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import { LoginLandingTopbar } from "../topbar";
import { LandingFooter } from "./footer";
import { LoginLanding } from "./landing";

// exa-style footer reveal: the foreground content sits on a higher layer and
// "peels up" as you reach the bottom, uncovering the footer pinned behind it.
// Falls back to a normal in-flow footer when it's taller than the viewport.
export function LandingShell({ onContinue }: { onContinue: () => void }): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const { scrollY } = useScroll({ container: scrollRef });

  useEffect(() => {
    const measure = (): void => {
      setViewportHeight(window.innerHeight);
      if (footerRef.current) {
        setFooterHeight(footerRef.current.offsetHeight);
      }
      if (scrollRef.current) {
        setMaxScroll(Math.max(0, scrollRef.current.scrollHeight - scrollRef.current.clientHeight));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (footerRef.current) {
      observer.observe(footerRef.current);
    }
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const reveal = footerHeight > 0 && viewportHeight > 0 && footerHeight <= viewportHeight;

  // The footer's own reveal fraction: 0 the instant it starts peeking out
  // (scrollY = maxScroll − footerHeight) → 1 at the very bottom (scrollY =
  // maxScroll). The footer text uses this to go blurred → fully sharp.
  const revealStart = Math.max(0, maxScroll - footerHeight);
  const revealEnd = Math.max(revealStart + 1, maxScroll);
  const revealProgress = useTransform(scrollY, [revealStart, revealEnd], [0, 1], { clamp: true });

  return (
    <div ref={scrollRef} className="bg-paper-100 fixed inset-0 overflow-x-hidden overflow-y-auto">
      <div
        ref={contentRef}
        className="bg-paper-100 relative z-10 shadow-[0_24px_48px_-16px_rgba(11,26,20,0.45)]"
        style={reveal ? { marginBottom: footerHeight } : undefined}
      >
        <LoginLandingTopbar onContinue={onContinue} />
        <LoginLanding onContinue={onContinue} />
      </div>
      <div ref={footerRef} className={reveal ? "fixed inset-x-0 bottom-0 z-0" : "relative z-0"}>
        <LandingFooter revealProgress={revealProgress} />
      </div>
    </div>
  );
}
