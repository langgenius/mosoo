import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import type { ReactElement, ReactNode } from "react";

// Quick, eased-out reveals — fades and small upward translates only. No spring,
// no bounce, no spin (per the brand motion guidance). Reduced-motion users get
// the resolved state with zero animation via `initial={false}`.

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } },
};

export const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
};

const REVEAL_VIEWPORT = { once: true, margin: "-80px" } as const;

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
    <motion.div
      className={className}
      initial={reduceMotion ? false : "hidden"}
      whileInView="visible"
      viewport={REVEAL_VIEWPORT}
      variants={fadeUp}
      transition={{ duration: 0.24, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
