import type { ReactElement } from "react";

import { LoginAuthCard } from "./auth-card";
import { LandingShell } from "./landing/landing-shell";
import { LoginAuthTopbar } from "./topbar";
import { useLoginFlow } from "./use-login";

const authBackgroundStyle = {
  background:
    "radial-gradient(900px 500px at 85% -10%, rgba(28,32,36,.04), transparent 60%), var(--bg)",
} as const;

export function LoginPage(): ReactElement {
  const login = useLoginFlow();
  const handleEmailChange = login.updateEmail;
  const handleGoogleLogin = () => {
    void login.handleGoogleLogin();
  };
  const handleLandingOpen = login.openLanding;
  const handleOpenAuth = login.openAuth;
  const handleOtpChange = login.updateOtp;
  const handleSendOtp = () => {
    void login.handleSendOtp();
  };
  const handleUseDifferentEmail = login.useDifferentEmail;
  const handleVerifyOtp = () => {
    void login.handleVerifyOtp();
  };

  if (login.step === "landing") {
    return <LandingShell onContinue={handleOpenAuth} />;
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={authBackgroundStyle}>
      <LoginAuthTopbar onBack={handleLandingOpen} />
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
