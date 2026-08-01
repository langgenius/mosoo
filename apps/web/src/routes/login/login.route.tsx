import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactElement } from "react";

import { LoginAuthCard } from "./auth-card";
import { loadLoginDoodles } from "./login-doodles-loader";
import { LoginAuthTopbar } from "./topbar";
import { useLoginFlow } from "./use-login";

const LoginDoodles = lazy(loadLoginDoodles);

// Warm cream ground so the hand-drawn doodle characters read as paper, not UI.
const authBackgroundStyle = {
  background:
    "radial-gradient(900px 500px at 85% -10%, rgba(28,32,36,.04), transparent 60%), #FDFBF7",
} as const;

function DeferredLoginDoodles(): ReactElement | null {
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
      <LoginDoodles />
    </Suspense>
  );
}

export function LoginPage(): ReactElement {
  const login = useLoginFlow();
  const handleEmailChange = login.updateEmail;
  const handleGoogleLogin = () => {
    void login.handleGoogleLogin();
  };
  const handleOtpChange = login.updateOtp;
  const handleSendOtp = () => {
    void login.handleSendOtp();
  };
  const handleUseDifferentEmail = login.useDifferentEmail;
  const handleVerifyOtp = () => {
    void login.handleVerifyOtp();
  };

  return (
    <div className="fixed inset-0 flex flex-col" style={authBackgroundStyle}>
      <DeferredLoginDoodles />
      <LoginAuthTopbar />
      <LoginAuthCard
        email={login.email}
        error={login.error}
        onChangeEmail={handleEmailChange}
        onChangeOtp={handleOtpChange}
        onGoogleLogin={handleGoogleLogin}
        onSendOtp={handleSendOtp}
        onUseDifferentEmail={handleUseDifferentEmail}
        onVerifyOtp={handleVerifyOtp}
        otp={login.otp}
        otpSending={login.otpSending}
        otpVerifying={login.otpVerifying}
        step={login.step}
      />
    </div>
  );
}
