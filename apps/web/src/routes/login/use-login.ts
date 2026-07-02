import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { authClient } from "../../domains/auth/api/auth-client";
import {
  shouldUseMosooAiDevelopmentBackdoor,
  signInWithMosooAiDevelopmentBackdoor,
} from "../../domains/auth/mosoo-ai-development-backdoor";
import { userKeys } from "../../domains/user/query/user-queries";
import {
  decodeAuthError,
  deriveNameFromEmail,
  getAuthClientErrorMessage,
  getErrorMessage,
  getSocialAuthErrorMessage,
} from "./copy";

export type AuthStep = "auth" | "otp";

const LOGIN_STEP_KEY = "mosoo_login_step";
const LOGIN_EMAIL_KEY = "mosoo_login_email";

export interface LoginFlow {
  email: string;
  error: string | null;
  handleGoogleLogin: () => Promise<void>;
  handleSendOtp: () => Promise<void>;
  handleVerifyOtp: () => Promise<void>;
  otp: string;
  otpSending: boolean;
  otpVerifying: boolean;
  step: AuthStep;
  updateEmail: (value: string) => void;
  updateOtp: (value: string) => void;
  useDifferentEmail: () => void;
}

function getPersistedStep(): AuthStep | null {
  try {
    const value = sessionStorage.getItem(LOGIN_STEP_KEY);
    if (value === "auth" || value === "otp") {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

function getPersistedEmail(): string {
  try {
    return sessionStorage.getItem(LOGIN_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistLoginState(step: AuthStep, email: string): void {
  try {
    sessionStorage.setItem(LOGIN_STEP_KEY, step);
    sessionStorage.setItem(LOGIN_EMAIL_KEY, email);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

function clearPersistedLoginState(): void {
  try {
    sessionStorage.removeItem(LOGIN_STEP_KEY);
    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function useLoginFlow(): LoginFlow {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = searchParams.get("redirect") ?? "/";
  const loginErrorCallbackUrl =
    redirectPath === "/" ? "/login" : `/login?redirect=${encodeURIComponent(redirectPath)}`;
  const authError =
    decodeAuthError(searchParams.get("error")) ??
    searchParams.get("error_description") ??
    decodeAuthError(searchParams.get("auth_error"));

  const persistedStep = getPersistedStep();
  const initialStep: AuthStep = authError === null ? (persistedStep ?? "auth") : "auth";
  const initialEmail = persistedStep === null ? "" : getPersistedEmail();

  const [step, setStep] = useState<AuthStep>(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [error, setError] = useState<string | null>(authError);

  async function finishSuccessfulLogin(): Promise<void> {
    clearPersistedLoginState();
    await queryClient.invalidateQueries({ queryKey: userKeys.viewer() });
    await queryClient.refetchQueries({ queryKey: userKeys.viewer() });
    void navigate(redirectPath, { replace: true });
  }

  async function handleGoogleLogin(): Promise<void> {
    setError(null);

    const result = await authClient["signIn"].social({
      callbackURL: redirectPath,
      errorCallbackURL: loginErrorCallbackUrl,
      provider: "google",
    });

    if (result.error) {
      setError(getSocialAuthErrorMessage(result.error));
    }
  }

  async function handleSendOtp(): Promise<void> {
    const normalizedEmail = email.trim();

    if (normalizedEmail.length === 0 || !normalizedEmail.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setError(null);
    setOtpSending(true);

    try {
      if (shouldUseMosooAiDevelopmentBackdoor(normalizedEmail)) {
        await signInWithMosooAiDevelopmentBackdoor(normalizedEmail);
        await finishSuccessfulLogin();
        return;
      }

      const result = await authClient["emailOtp"].sendVerificationOtp({
        email: normalizedEmail,
        type: "sign-in",
      });

      if (result.error) {
        setError(getAuthClientErrorMessage(result.error));
        return;
      }

      setEmail(normalizedEmail);
      setStep("otp");
      persistLoginState("otp", normalizedEmail);
    } catch (nextError: unknown) {
      const message = getErrorMessage(nextError);
      setError(message.length > 0 ? message : "Failed to send verification code");
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp(): Promise<void> {
    if (otp.length < 4) {
      setError("Please enter the verification code");
      return;
    }

    setError(null);
    setOtpVerifying(true);

    try {
      const normalizedEmail = email.trim();
      const result = await authClient["signIn"].emailOtp({
        email: normalizedEmail,
        name: deriveNameFromEmail(normalizedEmail),
        otp,
      });

      if (result.error) {
        setError(getAuthClientErrorMessage(result.error));
        return;
      }

      await finishSuccessfulLogin();
    } catch (nextError: unknown) {
      const message = getErrorMessage(nextError);
      setError(message.length > 0 ? message : "Invalid verification code");
    } finally {
      setOtpVerifying(false);
    }
  }

  function useDifferentEmail(): void {
    setStep("auth");
    setOtp("");
    setError(null);
    persistLoginState("auth", "");
  }

  function updateEmail(value: string): void {
    setEmail(value);
    setError(null);
    persistLoginState(step, value);
  }

  function updateOtp(value: string): void {
    setOtp(value.replaceAll(/\D/g, "").slice(0, 6));
    setError(null);
  }

  return {
    email,
    error,
    handleGoogleLogin,
    handleSendOtp,
    handleVerifyOtp,
    otp,
    otpSending,
    otpVerifying,
    step,
    updateEmail,
    updateOtp,
    useDifferentEmail,
  };
}
