import { lazy, Suspense } from "react";
import type { ComponentType, ReactElement } from "react";

import { LoginAuthCard } from "./auth-card";
import { LoginAuthTopbar } from "./topbar";
import { useLoginFlow } from "./use-login";

function NoLoginDoodles(): null {
  return null;
}

// Decorative art must never take down the sign-in form: the console has no
// error boundary, so a rejected chunk import would unmount the whole page.
const LoginDoodles = lazy<ComponentType>(async () => {
  try {
    return { default: (await import("./doodles")).LoginDoodles };
  } catch {
    return { default: NoLoginDoodles };
  }
});

// Warm cream ground so the hand-drawn doodle characters read as paper, not UI.
const authBackgroundStyle = {
  background:
    "radial-gradient(900px 500px at 85% -10%, rgba(28,32,36,.04), transparent 60%), #FDFBF7",
} as const;

export function LoginPage(): ReactElement {
  const login = useLoginFlow();

  return (
    <div className="fixed inset-0 flex flex-col" style={authBackgroundStyle}>
      <Suspense fallback={null}>
        <LoginDoodles />
      </Suspense>
      <LoginAuthTopbar />
      <LoginAuthCard
        email={login.email}
        error={login.error}
        onChangeEmail={login.updateEmail}
        onChangeOtp={login.updateOtp}
        onGoogleLogin={() => {
          void login.handleGoogleLogin();
        }}
        onSendOtp={() => {
          void login.handleSendOtp();
        }}
        onUseDifferentEmail={login.useDifferentEmail}
        onVerifyOtp={() => {
          void login.handleVerifyOtp();
        }}
        otp={login.otp}
        otpSending={login.otpSending}
        otpVerifying={login.otpVerifying}
        step={login.step}
      />
    </div>
  );
}
