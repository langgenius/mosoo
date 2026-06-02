import { AGENT_BUILDER_TOOL_ID_VALUES } from "@mosoo/contracts/agent-builder";

import {
  AGENT_BUILDER_WORKFLOW_INTENT_CLASSES,
  AGENT_BUILDER_WORKFLOW_SOURCE_MODES,
} from "./builder-workflow-code-plan";

type AgentBuilderWorkflowCodeResponseInputItem = Record<string, unknown>;

export const AGENT_BUILDER_WORKFLOW_CODE_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    code: {
      description: "A single async arrow function body for Cloudflare Code Mode execution.",
      type: "string",
    },
    intentClass: {
      description: "The Builder intent classification used before writing workflow code.",
      enum: AGENT_BUILDER_WORKFLOW_INTENT_CLASSES,
      type: "string",
    },
    sourceMode: {
      description: "The planner output mode that this workflow projects through Starter Pack.",
      enum: AGENT_BUILDER_WORKFLOW_SOURCE_MODES,
      type: "string",
    },
    toolSequence: {
      description:
        "The ordered builder.* tool ids that the workflow code intends to call for this intent.",
      items: {
        enum: AGENT_BUILDER_TOOL_ID_VALUES,
        type: "string",
      },
      type: "array",
    },
  },
  required: ["intentClass", "sourceMode", "toolSequence", "code"],
  type: "object",
} as const;

export interface AgentBuilderWorkflowCodeGenerationRequestBody {
  input: AgentBuilderWorkflowCodeResponseInputItem[];
  max_output_tokens: number;
  model: string;
  text: {
    format: {
      name: "agent_builder_assembly_workflow_code";
      schema: typeof AGENT_BUILDER_WORKFLOW_CODE_OUTPUT_SCHEMA;
      strict: true;
      type: "json_schema";
    };
  };
}

export type AgentBuilderWorkflowCodeGenerationRequester = (
  requestBody: AgentBuilderWorkflowCodeGenerationRequestBody,
) => Promise<unknown>;
