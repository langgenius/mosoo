import type { E2ECase } from "./cases";

export interface E2ERunTarget {
  readonly args: readonly string[];
  readonly entries: readonly E2ECase[];
  readonly label: string;
}

function normalizeArgs(args: readonly string[]): readonly string[] {
  return args[0] === "--" ? args.slice(1) : args;
}

function matchCase(cases: readonly E2ECase[], args: readonly string[]): E2ERunTarget | null {
  const normalized = normalizeArgs(args);

  for (const entry of cases.toSorted((left, right) => right.id.length - left.id.length)) {
    const matches = entry.id.every((part, index) => normalized[index] === part);

    if (matches) {
      return {
        args: normalizeArgs(normalized.slice(entry.id.length)),
        entries: [entry],
        label: entry.id.join(" "),
      };
    }
  }

  return null;
}

function matchLayer(cases: readonly E2ECase[], args: readonly string[]): E2ERunTarget | null {
  const normalized = normalizeArgs(args);
  const layer = normalized[0] ?? "";
  const entries = cases.filter((entry) => entry.layer === layer);

  if (entries.length === 0) {
    return null;
  }

  return {
    args: normalizeArgs(normalized.slice(1)),
    entries,
    label: layer,
  };
}

export function matchE2ERunTarget(
  cases: readonly E2ECase[],
  args: readonly string[],
): E2ERunTarget | null {
  return matchCase(cases, args) ?? matchLayer(cases, args);
}
