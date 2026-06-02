import { formatHarnessError } from "./harness-error";

export const REQUIRED_RUNTIME_SIGNAL_CATEGORIES = [
  "application_lifecycle",
  "feature_path_execution",
  "data_flow",
  "resource_utilization",
  "errors_exceptions",
] as const;

export type RuntimeSignalCategory = (typeof REQUIRED_RUNTIME_SIGNAL_CATEGORIES)[number];

export type RuntimeSignalValue =
  | boolean
  | null
  | number
  | string
  | readonly RuntimeSignalValue[]
  | { readonly [key: string]: RuntimeSignalValue };

export interface RuntimeHarnessSignal {
  readonly category: RuntimeSignalCategory;
  readonly context?: Record<string, RuntimeSignalValue>;
  readonly name: string;
  readonly observedAt: string;
  readonly source: string;
}

export interface RuntimeSignalCoverageSummary {
  readonly categories: readonly {
    readonly category: RuntimeSignalCategory;
    readonly count: number;
  }[];
  readonly missingCategories: readonly RuntimeSignalCategory[];
  readonly requiredCategories: readonly RuntimeSignalCategory[];
  readonly signalCount: number;
}

export interface RuntimeSignalCoverageOptions {
  readonly fix?: string;
}

export function summarizeRuntimeSignalCoverage(
  signals: readonly RuntimeHarnessSignal[],
): RuntimeSignalCoverageSummary {
  const counts = new Map<RuntimeSignalCategory, number>();

  for (const category of REQUIRED_RUNTIME_SIGNAL_CATEGORIES) {
    counts.set(category, 0);
  }

  for (const signal of signals) {
    counts.set(signal.category, (counts.get(signal.category) ?? 0) + 1);
  }

  const categories = REQUIRED_RUNTIME_SIGNAL_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));

  return {
    categories,
    missingCategories: categories
      .filter((category) => category.count === 0)
      .map((category) => category.category),
    requiredCategories: REQUIRED_RUNTIME_SIGNAL_CATEGORIES,
    signalCount: signals.length,
  };
}

export function assertRuntimeSignalCoverage(
  signals: readonly RuntimeHarnessSignal[],
  options: RuntimeSignalCoverageOptions = {},
): void {
  const summary = summarizeRuntimeSignalCoverage(signals);

  if (summary.missingCategories.length === 0) {
    return;
  }

  throw new Error(
    formatHarnessError({
      fix:
        options.fix ??
        "Attach `createRuntimeSignalCollector(...).attachToPage(page)` before navigation, add feature checkpoints / resource samples, or record a live-smoke-only gap in the PR / handoff evidence.",
      what: `Runtime signal collection is missing required coverage: ${summary.missingCategories.join(", ")}.`,
      why: "Lecture 11 and the Mosoo harness contract require the harness to collect lifecycle, feature path, data flow, resource utilization, and error context signals instead of relying on agent-written logs.",
    }),
  );
}
