import { m, useReducedMotion } from "motion/react";
import type { ReactElement, ReactNode } from "react";

import { EASE_OUT, fadeUp, REVEAL_VIEWPORT } from "./motion-variants";

/** Reveals its children with a fade-up as they scroll into view. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}): ReactElement {
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      className={className}
      initial={reduceMotion ? false : "hidden"}
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      variants={fadeUp}
      transition={{ duration: 0.24, ease: EASE_OUT, delay }}
    >
      {children}
    </m.div>
  );
}
