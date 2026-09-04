import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { loadAuthDoodles } from "./auth-doodles-loader";
import { AuthTopbar } from "./auth-topbar";
import type { AuthBrandVariant } from "./auth-topbar";

const AuthDoodles = lazy(loadAuthDoodles);

// Warm cream ground so the hand-drawn doodle characters read as paper, not UI.
const authBackgroundStyle = {
  background:
    "radial-gradient(900px 500px at 85% -10%, rgba(28,32,36,.04), transparent 60%), #FDFBF7",
} as const;

function DeferredAuthDoodles(): ReactElement | null {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let idleId: number | null = null;
    let timeoutId: number | null = null;

    const reveal = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => {
          setMounted(true);
        });
        return;
      }

      timeoutId = window.setTimeout(() => {
        setMounted(true);
      }, 250);
    };

    if (document.readyState === "complete") {
      timeoutId = window.setTimeout(reveal, 0);
    } else {
      window.addEventListener("load", reveal, { once: true });
    }

    return () => {
      window.removeEventListener("load", reveal);
      if (idleId !== null) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <AuthDoodles />
    </Suspense>
  );
}

// Shared shell for the auth surfaces (web sign-in and CLI/device sign-in): the
// cream ground, the deferred floating doodle art, and the brand topbar. The
// `brand` variant is the only thing that differs between the two.
export function AuthScene({
  brand = "default",
  children,
}: {
  brand?: AuthBrandVariant;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="fixed inset-0 flex flex-col" style={authBackgroundStyle}>
      <DeferredAuthDoodles />
      <AuthTopbar brand={brand} />
      {children}
    </div>
  );
}
