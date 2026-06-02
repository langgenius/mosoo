export interface HarnessErrorInput {
  fix: string;
  sources?: readonly string[];
  what: string;
  why: string;
}

export function formatHarnessError(input: HarnessErrorInput): string {
  const sources =
    input.sources === undefined || input.sources.length === 0
      ? ""
      : `\nSOURCES: ${input.sources.join(", ")}`;

  return [`WHAT: ${input.what}`, `WHY: ${input.why}`, `FIX: ${input.fix}${sources}`].join("\n");
}
