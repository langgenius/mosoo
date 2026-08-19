import type { ApiCommandKind } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, FileId, SessionId, SessionRunId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type {
  CostLedgerReconciliationCursor,
  CostLedgerReconciliationMode,
} from "../../cost/application/cost-ledger-reconciliation.service";

type ApiCommandPayload =
  | CostLedgerReconciliationCommandPayload
  | EnvironmentPackageArtifactBuildCommandPayload
  | ScheduledMaintenanceCommandPayload
  | SessionRunDispatchCommandPayload;

type JsonRecord = Record<string, unknown>;

export interface ScheduledMaintenanceCommandPayload {
  scheduledTime: number;
}

export interface CostLedgerReconciliationCommandPayload {
  cursor: CostLedgerReconciliationCursor | null;
  mode: CostLedgerReconciliationMode;
  scheduledTime: number;
}

export interface EnvironmentPackageArtifactBuildCommandPayload {
  appId: AppId;
  artifactAbi: string;
  inputDigest: string;
  packages: { manager: "npm" | "pip"; packages: string[] }[];
}

export interface SessionRunDispatchCommandPayload {
  accessViewer?: AuthenticatedViewer;
  attachmentIds: FileId[];
  prompt: string;
  queuedAtMs: number;
  requestUrl: string;
  session: {
    id: SessionId;
    app_id: AppId;
  };
  sessionRunId: SessionRunId;
  traceId: string;
  viewer: AuthenticatedViewer;
}

export class ApiCommandPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiCommandPayloadError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new ApiCommandPayloadError(`${label} must be an object.`);
  }

  return value;
}

function readString(record: JsonRecord, field: string, label: string): string {
  const value = record[field];

  if (typeof value !== "string") {
    throw new ApiCommandPayloadError(`${label}.${field} must be a string.`);
  }

  return value;
}

function readNonEmptyString(record: JsonRecord, field: string, label: string): string {
  const value = readString(record, field, label);

  if (value.trim().length === 0) {
    throw new ApiCommandPayloadError(`${label}.${field} must not be empty.`);
  }

  return value;
}

function readOptionalString(record: JsonRecord, field: string, label: string): string | null {
  const value = record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiCommandPayloadError(`${label}.${field} must be a string or null.`);
  }

  return value;
}

function readBoolean(record: JsonRecord, field: string, label: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new ApiCommandPayloadError(`${label}.${field} must be a boolean.`);
  }

  return value;
}

function readInteger(record: JsonRecord, field: string, label: string): number {
  const value = record[field];

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ApiCommandPayloadError(`${label}.${field} must be an integer.`);
  }

  return value;
}

function readStringArray(record: JsonRecord, field: string, label: string): string[] {
  const value = record[field];

  if (!Array.isArray(value)) {
    throw new ApiCommandPayloadError(`${label}.${field} must be an array.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new ApiCommandPayloadError(`${label}.${field}[${index}] must be a string.`);
    }

    return item;
  });
}

function readViewer(value: unknown, label: string): AuthenticatedViewer {
  const record = requireRecord(value, label);
  return {
    email: readNonEmptyString(record, "email", label),
    emailVerified: readBoolean(record, "emailVerified", label),
    id: parsePlatformId<AccountId>(record["id"], `${label}.id`),
    imageUrl: readOptionalString(record, "imageUrl", label),
    name: readString(record, "name", label),
  };
}

function parseSessionRunDispatchPayload(value: unknown): SessionRunDispatchCommandPayload {
  const record = requireRecord(value, "session_run_dispatch payload");
  const session = requireRecord(record["session"], "session_run_dispatch payload.session");
  const accessViewer = record["accessViewer"];

  return {
    ...(accessViewer === undefined
      ? {}
      : { accessViewer: readViewer(accessViewer, "session_run_dispatch payload.accessViewer") }),
    attachmentIds: readStringArray(record, "attachmentIds", "session_run_dispatch payload").map(
      (id, index) => parsePlatformId<FileId>(id, `attachmentIds[${index}]`),
    ),
    prompt: readString(record, "prompt", "session_run_dispatch payload"),
    queuedAtMs: readInteger(record, "queuedAtMs", "session_run_dispatch payload"),
    requestUrl: readNonEmptyString(record, "requestUrl", "session_run_dispatch payload"),
    session: {
      id: parsePlatformId<SessionId>(session["id"], "session_run_dispatch payload.session.id"),
      app_id: parsePlatformId<AppId>(
        session["app_id"],
        "session_run_dispatch payload.session.app_id",
      ),
    },
    sessionRunId: parsePlatformId<SessionRunId>(
      record["sessionRunId"],
      "session_run_dispatch payload.sessionRunId",
    ),
    traceId: readNonEmptyString(record, "traceId", "session_run_dispatch payload"),
    viewer: readViewer(record["viewer"], "session_run_dispatch payload.viewer"),
  };
}

function parseScheduledMaintenancePayload(value: unknown): ScheduledMaintenanceCommandPayload {
  const record = requireRecord(value, "scheduled_maintenance payload");

  return {
    scheduledTime: readInteger(record, "scheduledTime", "scheduled_maintenance payload"),
  };
}

function parseCostLedgerReconciliationPayload(
  value: unknown,
): CostLedgerReconciliationCommandPayload {
  const label = "cost_ledger_reconciliation payload";
  const record = requireRecord(value, label);
  const cursor = readOptionalString(record, "cursor", label);
  const mode = readNonEmptyString(record, "mode", label);

  if (mode !== "audit" && mode !== "repair") {
    throw new ApiCommandPayloadError(`${label}.mode must be 'audit' or 'repair'.`);
  }

  if (cursor !== null && cursor.length === 0) {
    throw new ApiCommandPayloadError(`${label}.cursor must not be empty.`);
  }

  const scheduledTime = readInteger(record, "scheduledTime", label);

  if (scheduledTime < 0 || !Number.isFinite(new Date(scheduledTime).getTime())) {
    throw new ApiCommandPayloadError(`${label}.scheduledTime must be a valid timestamp.`);
  }

  return { cursor, mode, scheduledTime };
}

function parseEnvironmentPackageArtifactBuildPayload(
  value: unknown,
): EnvironmentPackageArtifactBuildCommandPayload {
  const label = "environment_package_artifact_build payload";
  const record = requireRecord(value, label);
  const packageEntries = record["packages"];

  if (!Array.isArray(packageEntries)) {
    throw new ApiCommandPayloadError(`${label}.packages must be an array.`);
  }

  const packages: EnvironmentPackageArtifactBuildCommandPayload["packages"] = packageEntries.map(
    (entry, index) => {
      const packageRecord = requireRecord(entry, `${label}.packages[${index}]`);
      const manager = readNonEmptyString(packageRecord, "manager", `${label}.packages[${index}]`);

      if (manager !== "npm" && manager !== "pip") {
        throw new ApiCommandPayloadError(`${label}.packages[${index}].manager is unsupported.`);
      }

      return {
        manager,
        packages: readStringArray(packageRecord, "packages", `${label}.packages[${index}]`),
      };
    },
  );

  return {
    appId: parsePlatformId<AppId>(record["appId"], `${label}.appId`),
    artifactAbi: readNonEmptyString(record, "artifactAbi", label),
    inputDigest: readNonEmptyString(record, "inputDigest", label),
    packages,
  };
}

function parsePayloadJson(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch (error) {
    throw new ApiCommandPayloadError("API command payload JSON is invalid.", { cause: error });
  }
}

export function parseApiCommandPayload(
  kind: ApiCommandKind,
  payloadJson: string,
): ApiCommandPayload {
  const parsed = parsePayloadJson(payloadJson);

  switch (kind) {
    case "cost_ledger_reconciliation":
      return parseCostLedgerReconciliationPayload(parsed);
    case "environment_package_artifact_build":
      return parseEnvironmentPackageArtifactBuildPayload(parsed);
    case "scheduled_maintenance":
      return parseScheduledMaintenancePayload(parsed);
    case "session_run_dispatch":
      return parseSessionRunDispatchPayload(parsed);
  }
}
