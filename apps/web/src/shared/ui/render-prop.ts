import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

/**
 * Base UI replaces Radix's `asChild` + child-merge convention with a `render`
 * prop. This bridges the two so our wrapper primitives can keep accepting
 * `asChild` without every call site changing: when `asChild` is set and the
 * single child is an element, it becomes Base UI's `render` target and the
 * wrapper's own props (data-slot, className, handlers) are merged onto it.
 */
export function asChildRender(
  asChild: boolean | undefined,
  children: ReactNode,
): ReactElement | undefined {
  return asChild && isValidElement(children) ? children : undefined;
}
