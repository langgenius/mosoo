import { type } from "arktype";

import { MOSOO_CUSTOM_EVENT } from "./custom-event-registry";
import {
  SessionCommandOptionSchema,
  SessionConfigOptionSchema,
  SessionModeOptionSchema,
  SessionPermissionRequestViewSchema,
  SessionViewFileSchema,
  SessionViewPlanEntrySchema,
} from "./session-live-state-schema";

function eventNameLiteral(name: string): `"${string}"` {
  return JSON.stringify(name) as `"${string}"`;
}

const MosooSessionFileDeleteChangeSchema = type({
  change: '"delete"',
  fileId: "string",
});

const MosooSessionFileUpsertChangeSchema = type({
  change: '"upsert"',
  file: SessionViewFileSchema,
});

const MosooSessionFilesUpdatedValueSchema = type({
  "change?": type.or(MosooSessionFileDeleteChangeSchema, MosooSessionFileUpsertChangeSchema),
  "files?": SessionViewFileSchema.array(),
});

export const MosooCustomEventSchema = type.or(
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionToolInputUpdated.name),
    type: '"CUSTOM"',
    value: {
      rawInput: "string",
      toolCallId: "string > 0",
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionCommandsUpdated.name),
    type: '"CUSTOM"',
    value: {
      commands: SessionCommandOptionSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionConfigUpdated.name),
    type: '"CUSTOM"',
    value: {
      configOptions: SessionConfigOptionSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionFilesUpdated.name),
    type: '"CUSTOM"',
    value: MosooSessionFilesUpdatedValueSchema,
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionModeUpdated.name),
    type: '"CUSTOM"',
    value: {
      currentModeId: "string | null",
      visibleModes: SessionModeOptionSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name),
    type: '"CUSTOM"',
    value: {
      permissionRequests: SessionPermissionRequestViewSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionPlanUpdated.name),
    type: '"CUSTOM"',
    value: {
      plan: SessionViewPlanEntrySchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionInfoUpdated.name),
    type: '"CUSTOM"',
    value: {
      "title?": "string | null",
      "updatedAt?": "string | null",
    },
  }),
);
