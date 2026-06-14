import { Loader2 } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Separator } from "@/shared/ui/separator";

import type { AuthStep } from "./use-login";

const AUTH_CARD_STYLE = { boxShadow: "var(--shadow-md)" } satisfies CSSProperties;

interface LoginAuthCardProps {
  email: string;
  error: string | null;
  onChangeEmail: (value: string) => void;
  onChangeOtp: (value: string) => void;
  onGoogleLogin: () => void;
  onSendOtp: () => void;
  onUseDifferentEmail: () => void;
  onVerifyOtp: () => void;
  otp: string;
  otpSending: boolean;
  otpVerifying: boolean;
  step: AuthStep;
}

export function LoginAuthCard({
  email,
  error,
  onChangeEmail,
  onChangeOtp,
  onGoogleLogin,
  onSendOtp,
  onUseDifferentEmail,
  onVerifyOtp,
  otp,
  otpSending,
  otpVerifying,
  step,
}: LoginAuthCardProps): ReactElement {
  const isOtpStep = step === "otp";
  const heading = step === "otp" ? "Check your email" : "Start building in 30 seconds";
  const subheading =
    step === "otp"
      ? "Enter the verification code we just sent you."
      : "No credit card required. Free to start.";

  return (
    <div className="flex flex-1 items-center justify-center px-6 pb-16">
      <div
        className="border-border bg-card w-full max-w-[420px] rounded-xl border p-8"
        style={AUTH_CARD_STYLE}
      >
        <h2 className="text-fg-1 text-center text-[26px] font-semibold tracking-[-0.02em]">
          {heading}
        </h2>
        <p className="text-fg-2 mt-2 text-center text-[14px]">{subheading}</p>

        <div className="mt-7 space-y-3">
          {isOtpStep ? (
            <>
              <p className="text-fg-2 text-center text-[13px]">
                We sent a code to <span className="text-fg-1 font-semibold">{email}</span>.
              </p>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={otp}
                onChange={(event) => {
                  onChangeOtp(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onVerifyOtp();
                  }
                }}
                className="h-11 text-center font-mono text-[15px] tracking-[0.3em]"
              />
              <Button
                size="lg"
                className="w-full justify-center"
                onClick={onVerifyOtp}
                disabled={otpVerifying}
              >
                {otpVerifying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Verify and continue"
                )}
              </Button>
              <button
                type="button"
                onClick={onUseDifferentEmail}
                className="text-fg-2 hover:text-fg-1 block w-full text-center text-[13px] transition-colors"
              >
                Use a different email
              </button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="lg"
                className="w-full justify-center"
                onClick={onGoogleLogin}
              >
                <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </Button>

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-fg-3 text-[11.5px] font-semibold tracking-[0.14em] uppercase">
                  or
                </span>
                <Separator className="flex-1" />
              </div>

              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => {
                  onChangeEmail(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onSendOtp();
                  }
                }}
                className="h-11 px-3.5 text-[14px]"
              />
              <Button
                size="lg"
                className="w-full justify-center"
                onClick={onSendOtp}
                disabled={otpSending}
              >
                {otpSending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send code"
                )}
              </Button>
            </>
          )}

          {error === null ? null : (
            <p className="text-destructive text-center text-[13px]">{error}</p>
          )}

          <p className="text-fg-3 pt-2 text-center text-[13px]">
            If this is your first time, we&apos;ll create your App workspace after verification.
          </p>
        </div>
      </div>
    </div>
  );
}
