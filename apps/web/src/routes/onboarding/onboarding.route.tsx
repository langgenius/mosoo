import { sleepPromise } from "@mosoo/effects";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useReducer } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "../../app/session-provider";
import { onboardingBootstrap } from "../../domains/onboarding/api/onboarding-client";
import { isTruthy } from "../../shared/lib/truthiness";
type OnboardingStep = "loading" | "provisioning" | "failed";
type OnboardingBootstrapInput = { name?: string };

interface OnboardingState {
  bootstrapping: boolean;
  error: string | null;
  step: OnboardingStep;
}

type OnboardingAction = { type: "bootstrapFailed"; error: string } | { type: "bootstrapStarted" };

const ONBOARDING_INITIAL_STATE: OnboardingState = {
  bootstrapping: false,
  error: null,
  step: "loading",
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function toOnboardingBootstrapInput(input?: {
  name?: string;
}): OnboardingBootstrapInput | undefined {
  if (input === undefined) {
    return undefined;
  }

  const nextInput: OnboardingBootstrapInput = {};

  if (input.name !== undefined) {
    nextInput.name = input.name;
  }

  return nextInput;
}

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "bootstrapFailed":
      return { ...state, bootstrapping: false, error: action.error, step: "failed" };
    case "bootstrapStarted":
      return {
        ...state,
        bootstrapping: true,
        error: null,
        step: "provisioning",
      };
  }
}

export function Onboarding() {
  const { refreshOrganizations } = useAppSession();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(onboardingReducer, ONBOARDING_INITIAL_STATE);
  const { error, step } = state;

  const handleBootstrap = useCallback(
    async (input?: { name?: string }) => {
      dispatch({ type: "bootstrapStarted" });
      try {
        await onboardingBootstrap(toOnboardingBootstrapInput(input));
        await Promise.all([refreshOrganizations(), sleepPromise(800)]);
        void navigate("/", { replace: true });
      } catch (caughtError: unknown) {
        dispatch({
          error: getErrorMessage(caughtError) || "Something went wrong",
          type: "bootstrapFailed",
        });
      }
    },
    [navigate, refreshOrganizations],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOnboarding() {
      try {
        await handleBootstrap();
      } catch (caughtError: unknown) {
        if (cancelled) {
          return;
        }

        const message = getErrorMessage(caughtError);

        if (message === "Unauthorized.") {
          void navigate("/login", { replace: true });
          return;
        }

        dispatch({ error: message, type: "bootstrapFailed" });
      }
    }

    void loadOnboarding();

    return () => {
      cancelled = true;
    };
  }, [handleBootstrap, navigate]);

  if (step === "loading") {
    return <OnboardingLoadingScreen />;
  }

  if (step === "provisioning") {
    return <OnboardingProvisioningScreen />;
  }

  return <OnboardingErrorScreen error={error} onRetry={() => void handleBootstrap()} />;
}

function OnboardingLoadingScreen() {
  return (
    <div className="bg-background fixed inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="text-primary size-8 animate-spin" />
        <p className="text-muted-foreground text-sm">Setting things up…</p>
      </div>
    </div>
  );
}

function OnboardingProvisioningScreen() {
  return (
    <div className="bg-background fixed inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="text-primary size-8 animate-spin" />
        <p className="text-muted-foreground text-sm">Creating your default App…</p>
      </div>
    </div>
  );
}

function OnboardingErrorScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      <div className="flex items-center px-4 py-5 sm:px-8">
        <span className="text-xl font-light tracking-tight">Mosoo</span>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[520px] px-6">
          <h2 className="text-foreground text-center text-2xl font-semibold">App setup failed</h2>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            {isTruthy(error) ? error : "Mosoo could not create your default App."}
          </p>

          <div className="mt-6">
            <button
              type="button"
              onClick={onRetry}
              className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg p-3 text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
