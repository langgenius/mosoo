import type { ReactElement } from "react";

import { AuthScene } from "@/shared/ui/auth-scene/auth-scene";

import { LoginAuthCard } from "./auth-card";
import { useLoginFlow } from "./use-login";

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
    <AuthScene brand="default">
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
    </AuthScene>
  );
}
