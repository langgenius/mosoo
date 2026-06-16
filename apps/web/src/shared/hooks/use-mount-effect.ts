import { useEffect } from "react";

export function useMountEffect(effect: () => void | (() => void)): void {
  useEffect(effect, []);
}
