import { useEffect, useState } from "react";

/**
 * Current time that re-renders on an interval, so relative "when" labels stay
 * honest after polling stops (a settled run must not read "just now" forever).
 */
export function useNowTick(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
