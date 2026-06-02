import type { BunRuntime } from "../../../dev/config/bun-script-types";

declare const Bun: BunRuntime;

const scriptDir = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/\/$/u, "");

const BASELINE_TAG = "0000_baseline";
const BASELINE_SQL_FILENAME = `${BASELINE_TAG}.sql`;
const BASELINE_TIMESTAMP = Date.UTC(2026, 5, 1);
const SNAPSHOT_FILENAME = "0000_snapshot.json";
const JOURNAL_FILENAME = "_journal.json";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonRecord(path: string): Promise<JsonRecord> {
  const value: unknown = JSON.parse(await Bun.file(path).text());

  if (!isJsonRecord(value)) {
    throw new Error(`Expected ${path} to contain a JSON object.`);
  }

  return value;
}

function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (!isJsonRecord(item)) {
      return item;
    }

    return Object.keys(item)
      .toSorted()
      .reduce<JsonRecord>((result, key) => {
        result[key] = item[key];
        return result;
      }, {});
  });

  if (serialized === undefined) {
    throw new Error("Cannot serialize undefined in Drizzle baseline metadata.");
  }

  return serialized;
}

function createStableUuid(value: unknown): string {
  const hex = new Bun.CryptoHasher("sha256").update(stableStringify(value)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function writeJsonRecord(path: string, value: JsonRecord): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function normalizeSqlFile(path: string): Promise<void> {
  await Bun.write(path, ensureTrailingNewline(await Bun.file(path).text()));
}

async function normalizeSnapshot(snapshotPath: string): Promise<void> {
  const snapshot = await readJsonRecord(snapshotPath);
  const snapshotForId = { ...snapshot };
  delete snapshotForId["id"];
  snapshot["id"] = createStableUuid(snapshotForId);
  await writeJsonRecord(snapshotPath, snapshot);
}

async function normalizeJournal(journalPath: string): Promise<void> {
  const journal = await readJsonRecord(journalPath);
  const entries = journal["entries"];
  const [entry] = Array.isArray(entries) ? entries : [];

  if (!Array.isArray(entries) || entries.length !== 1 || !isJsonRecord(entry)) {
    throw new Error(`Expected ${journalPath} to contain one baseline journal entry.`);
  }

  journal["entries"] = [
    {
      ...entry,
      tag: BASELINE_TAG,
      when: BASELINE_TIMESTAMP,
    },
  ];

  await writeJsonRecord(journalPath, journal);
}

function joinPath(...parts: readonly string[]): string {
  return parts
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/u, "") : part.replace(/^\/+|\/+$/gu, ""),
    )
    .filter((part) => part.length > 0)
    .join("/");
}

async function normalizeDrizzleBaseline(
  drizzleDir = joinPath(scriptDir, "../drizzle"),
): Promise<void> {
  const metaDir = joinPath(drizzleDir, "meta");

  await normalizeSqlFile(joinPath(drizzleDir, BASELINE_SQL_FILENAME));
  await normalizeSnapshot(joinPath(metaDir, SNAPSHOT_FILENAME));
  await normalizeJournal(joinPath(metaDir, JOURNAL_FILENAME));
}

if (import.meta.main) {
  await normalizeDrizzleBaseline(process.argv[2]);
}
