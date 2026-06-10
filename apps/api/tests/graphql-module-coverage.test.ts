import { describe, expect, test } from "bun:test";

import {
  FILE_SCOPE_KINDS,
  FILE_UPLOAD_STATUSES,
  FILE_UPLOAD_STRATEGIES,
} from "@mosoo/contracts/file";
import {
  AGENT_SESSION_ACTION_CAPABILITY_NAMES,
  AGENT_SESSION_ACTION_CAPABILITY_STATUSES,
  AGENT_SESSION_EVENT_TYPES,
  AGENT_SESSION_PERMISSION_DECISIONS,
  AGENT_SESSION_RECOVERABILITY_STATUSES,
  SESSION_PROCESS_EVENT_STATUSES,
  SESSION_PROCESS_EVENT_TYPE_CODES,
  SESSION_STATUSES,
  SESSION_TYPES,
} from "@mosoo/contracts/session";
import { SESSION_RUN_STATUSES, SESSION_RUN_TRIGGERS } from "@mosoo/contracts/session-run";
import { isEnumType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";

const apiSchema = createGraphQLSchema();

function collectEnumValues(enumName: string): string[] {
  const enumType = apiSchema.getType(enumName);

  if (!isEnumType(enumType)) {
    throw new Error(`Expected ${enumName} enum in GraphQL schema.`);
  }

  return enumType.getValues().map((value) => value.name);
}

describe("GraphQL module coverage", () => {
  test("keeps session and run enum values aligned with shared contracts", () => {
    expect(collectEnumValues("RunStatus")).toEqual([...SESSION_RUN_STATUSES]);
    expect(collectEnumValues("SessionRunTrigger")).toEqual([...SESSION_RUN_TRIGGERS]);
    expect(collectEnumValues("SessionStatus")).toEqual([...SESSION_STATUSES]);
    expect(collectEnumValues("SessionType")).toEqual([...SESSION_TYPES]);
    expect(collectEnumValues("SessionProcessEventStatus")).toEqual([
      ...SESSION_PROCESS_EVENT_STATUSES,
    ]);
    expect(collectEnumValues("SessionProcessEventType")).toEqual(
      Object.values(SESSION_PROCESS_EVENT_TYPE_CODES),
    );
    expect(collectEnumValues("AgentSessionEventType")).toEqual([...AGENT_SESSION_EVENT_TYPES]);
    expect(collectEnumValues("AgentSessionPermissionDecision")).toEqual([
      ...AGENT_SESSION_PERMISSION_DECISIONS,
    ]);
    expect(collectEnumValues("AgentSessionRecoverabilityStatus")).toEqual([
      ...AGENT_SESSION_RECOVERABILITY_STATUSES,
    ]);
    expect(collectEnumValues("AgentSessionActionCapabilityName")).toEqual([
      ...AGENT_SESSION_ACTION_CAPABILITY_NAMES,
    ]);
    expect(collectEnumValues("AgentSessionActionCapabilityStatus")).toEqual([
      ...AGENT_SESSION_ACTION_CAPABILITY_STATUSES,
    ]);
    expect(collectEnumValues("FileScopeKind")).toEqual([...FILE_SCOPE_KINDS]);
    expect(collectEnumValues("FileUploadStatus")).toEqual([...FILE_UPLOAD_STATUSES]);
    expect(collectEnumValues("FileUploadStrategy")).toEqual([...FILE_UPLOAD_STRATEGIES]);
  });
});
