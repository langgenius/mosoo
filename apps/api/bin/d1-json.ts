export type D1JsonRow = Readonly<Record<string, unknown>>;

function parseJsonArrayAt(raw: string, start: number): unknown {
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseD1JsonResults(raw: string): D1JsonRow[][] {
  for (let start = raw.indexOf("["); start !== -1; start = raw.indexOf("[", start + 1)) {
    const value = parseJsonArrayAt(raw, start);
    if (!Array.isArray(value) || value.length === 0) continue;

    const statements: D1JsonRow[][] = [];
    let valid = true;
    for (const result of value) {
      if (
        typeof result !== "object" ||
        result === null ||
        !("results" in result) ||
        !("success" in result) ||
        result.success !== true ||
        !Array.isArray(result.results)
      ) {
        valid = false;
        break;
      }
      const rows: D1JsonRow[] = [];
      for (const row of result.results) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          valid = false;
          break;
        }
        rows.push(row as D1JsonRow);
      }
      if (!valid) break;
      statements.push(rows);
    }
    if (valid) return statements;
  }
  throw new Error("D1 output has no successful JSON statement results.");
}

export function requireSingleD1Row(raw: string): D1JsonRow {
  const statements = parseD1JsonResults(raw);
  if (statements.length !== 1) {
    throw new Error("D1 JSON output must contain exactly one statement result.");
  }
  const rows = statements[0];
  if (rows?.length !== 1) throw new Error("D1 JSON output must contain exactly one row.");
  return rows[0];
}
