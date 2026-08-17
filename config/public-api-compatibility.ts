interface OpenApiBreakingChangeApproval {
  baselineSha256: string;
  change: string;
  compatibilityStartedAt: string;
  enforcementDate: string;
  issue: string;
  minimumClientVersion: string;
}

const HTTP_METHODS = ["delete", "get", "head", "options", "patch", "post", "put", "trace"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readStringSet(value: unknown): Set<string> {
  if (typeof value === "string") {
    return new Set([value]);
  }

  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(value.filter((item): item is string => typeof item === "string"));
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function compareNumericConstraint(input: {
  after: Record<string, unknown>;
  before: Record<string, unknown>;
  changes: string[];
  direction: "higher" | "lower";
  keyword: string;
  location: string;
}): void {
  const beforeValue = input.before[input.keyword];
  const afterValue = input.after[input.keyword];

  if (typeof afterValue !== "number") {
    return;
  }

  if (
    typeof beforeValue !== "number" ||
    (input.direction === "higher" ? afterValue > beforeValue : afterValue < beforeValue)
  ) {
    input.changes.push(`${input.location}.${input.keyword} became more restrictive`);
  }
}

function compareSchema(
  beforeValue: unknown,
  afterValue: unknown,
  location: string,
  changes: string[],
): void {
  if (beforeValue === true && afterValue === false) {
    changes.push(`${location} changed from an unconstrained schema to a rejecting schema`);
    return;
  }

  if (!isRecord(beforeValue) || !isRecord(afterValue)) {
    if (stableValue(beforeValue) !== stableValue(afterValue)) {
      changes.push(`${location} changed incompatibly`);
    }
    return;
  }

  const beforeRef = beforeValue["$ref"];
  const afterRef = afterValue["$ref"];

  if (typeof beforeRef === "string" && afterRef !== beforeRef) {
    changes.push(`${location} changed schema reference from ${beforeRef}`);
  }

  const beforeTypes = readStringSet(beforeValue["type"]);
  const afterTypes = readStringSet(afterValue["type"]);

  if (Object.hasOwn(afterValue, "type")) {
    for (const type of beforeTypes) {
      if (!afterTypes.has(type)) {
        changes.push(`${location}.type no longer accepts ${type}`);
      }
    }
  }

  const beforeEnum = Array.isArray(beforeValue["enum"]) ? beforeValue["enum"] : [];
  const afterEnum = new Set(
    (Array.isArray(afterValue["enum"]) ? afterValue["enum"] : []).map(stableValue),
  );

  if (Array.isArray(afterValue["enum"])) {
    if (!Array.isArray(beforeValue["enum"])) {
      changes.push(`${location}.enum was added`);
    } else {
      for (const enumValue of beforeEnum) {
        if (!afterEnum.has(stableValue(enumValue))) {
          changes.push(`${location}.enum removed ${stableValue(enumValue)}`);
        }
      }
    }
  }

  if (Object.hasOwn(afterValue, "const")) {
    if (!Object.hasOwn(beforeValue, "const")) {
      changes.push(`${location}.const was added`);
    } else if (stableValue(beforeValue["const"]) !== stableValue(afterValue["const"])) {
      changes.push(`${location}.const changed from ${stableValue(beforeValue["const"])}`);
    }
  }

  const beforeProperties = readRecord(beforeValue["properties"]);
  const afterProperties = readRecord(afterValue["properties"]);

  for (const [propertyName, propertySchema] of Object.entries(beforeProperties)) {
    if (!Object.hasOwn(afterProperties, propertyName)) {
      changes.push(`${location}.properties.${propertyName} was removed`);
      continue;
    }

    compareSchema(
      propertySchema,
      afterProperties[propertyName],
      `${location}.properties.${propertyName}`,
      changes,
    );
  }

  const beforeRequired = readStringSet(beforeValue["required"]);
  const afterRequired = readStringSet(afterValue["required"]);

  for (const propertyName of afterRequired) {
    if (!beforeRequired.has(propertyName)) {
      changes.push(`${location}.required added ${propertyName}`);
    }
  }

  for (const propertyName of beforeRequired) {
    if (!afterRequired.has(propertyName)) {
      changes.push(`${location}.required no longer guarantees ${propertyName}`);
    }
  }

  if (
    beforeValue["additionalProperties"] !== false &&
    afterValue["additionalProperties"] === false
  ) {
    changes.push(`${location}.additionalProperties now rejects unknown fields`);
  }

  for (const keyword of ["minItems", "minLength", "minimum"] as const) {
    compareNumericConstraint({
      after: afterValue,
      before: beforeValue,
      changes,
      direction: "higher",
      keyword,
      location,
    });
  }

  for (const keyword of ["maxItems", "maxLength", "maximum"] as const) {
    compareNumericConstraint({
      after: afterValue,
      before: beforeValue,
      changes,
      direction: "lower",
      keyword,
      location,
    });
  }

  for (const keyword of ["format", "pattern"] as const) {
    const beforeConstraint = beforeValue[keyword];
    const afterConstraint = afterValue[keyword];

    if (typeof afterConstraint === "string" && afterConstraint !== beforeConstraint) {
      changes.push(`${location}.${keyword} changed`);
    }
  }

  if (Object.hasOwn(beforeValue, "items")) {
    compareSchema(beforeValue["items"], afterValue["items"], `${location}.items`, changes);
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const beforeOptions = Array.isArray(beforeValue[keyword]) ? beforeValue[keyword] : [];
    const afterOptions = new Set(
      (Array.isArray(afterValue[keyword]) ? afterValue[keyword] : []).map(stableValue),
    );

    if (Array.isArray(afterValue[keyword])) {
      if (!Array.isArray(beforeValue[keyword])) {
        changes.push(`${location}.${keyword} was added`);
      } else {
        for (const option of beforeOptions) {
          if (!afterOptions.has(stableValue(option))) {
            changes.push(`${location}.${keyword} removed option ${stableValue(option)}`);
          }
        }
      }
    }
  }
}

function parameterKey(value: unknown): string | null {
  if (!isRecord(value) || typeof value["in"] !== "string" || typeof value["name"] !== "string") {
    return null;
  }

  return `${value["in"]}:${value["name"]}`;
}

function readParameters(...values: unknown[]): Map<string, Record<string, unknown>> {
  const parameters = new Map<string, Record<string, unknown>>();

  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }

    for (const parameter of value) {
      const key = parameterKey(parameter);

      if (key !== null && isRecord(parameter)) {
        parameters.set(key, parameter);
      }
    }
  }

  return parameters;
}

function compareContent(
  beforeValue: unknown,
  afterValue: unknown,
  location: string,
  changes: string[],
): void {
  const beforeContent = readRecord(beforeValue);
  const afterContent = readRecord(afterValue);

  for (const [mediaType, beforeMediaValue] of Object.entries(beforeContent)) {
    if (!Object.hasOwn(afterContent, mediaType)) {
      changes.push(`${location}.${mediaType} was removed`);
      continue;
    }

    const beforeMedia = readRecord(beforeMediaValue);
    const afterMedia = readRecord(afterContent[mediaType]);
    compareSchema(
      beforeMedia["schema"],
      afterMedia["schema"],
      `${location}.${mediaType}.schema`,
      changes,
    );
  }
}

function compareOperation(
  beforePathItem: Record<string, unknown>,
  afterPathItem: Record<string, unknown>,
  method: string,
  path: string,
  changes: string[],
): void {
  const beforeOperation = readRecord(beforePathItem[method]);
  const afterOperation = readRecord(afterPathItem[method]);
  const location = `paths.${path}.${method}`;
  const beforeParameters = readParameters(
    beforePathItem["parameters"],
    beforeOperation["parameters"],
  );
  const afterParameters = readParameters(afterPathItem["parameters"], afterOperation["parameters"]);

  for (const [key, beforeParameter] of beforeParameters) {
    const afterParameter = afterParameters.get(key);

    if (!afterParameter) {
      changes.push(`${location}.parameters removed ${key}`);
      continue;
    }

    if (beforeParameter["required"] !== true && afterParameter["required"] === true) {
      changes.push(`${location}.parameters made ${key} required`);
    }

    compareSchema(
      beforeParameter["schema"],
      afterParameter["schema"],
      `${location}.parameters.${key}.schema`,
      changes,
    );
  }

  for (const [key, afterParameter] of afterParameters) {
    if (!beforeParameters.has(key) && afterParameter["required"] === true) {
      changes.push(`${location}.parameters added required ${key}`);
    }
  }

  const beforeRequestBody = beforeOperation["requestBody"];
  const afterRequestBody = afterOperation["requestBody"];

  if (isRecord(beforeRequestBody) && !isRecord(afterRequestBody)) {
    changes.push(`${location}.requestBody was removed`);
  } else if (isRecord(afterRequestBody)) {
    const beforeBody = readRecord(beforeRequestBody);

    if (beforeBody["required"] !== true && afterRequestBody["required"] === true) {
      changes.push(`${location}.requestBody became required`);
    }

    compareContent(
      beforeBody["content"],
      afterRequestBody["content"],
      `${location}.requestBody.content`,
      changes,
    );
  }

  const beforeResponses = readRecord(beforeOperation["responses"]);
  const afterResponses = readRecord(afterOperation["responses"]);

  for (const [status, beforeResponseValue] of Object.entries(beforeResponses)) {
    if (!Object.hasOwn(afterResponses, status)) {
      changes.push(`${location}.responses removed ${status}`);
      continue;
    }

    const beforeResponse = readRecord(beforeResponseValue);
    const afterResponse = readRecord(afterResponses[status]);
    compareContent(
      beforeResponse["content"],
      afterResponse["content"],
      `${location}.responses.${status}.content`,
      changes,
    );
  }
}

export function findOpenApiBreakingChanges(beforeValue: unknown, afterValue: unknown): string[] {
  const before = readRecord(beforeValue);
  const after = readRecord(afterValue);
  const changes: string[] = [];
  const beforePaths = readRecord(before["paths"]);
  const afterPaths = readRecord(after["paths"]);

  for (const [path, beforePathValue] of Object.entries(beforePaths)) {
    if (!Object.hasOwn(afterPaths, path)) {
      changes.push(`paths.${path} was removed`);
      continue;
    }

    const beforePathItem = readRecord(beforePathValue);
    const afterPathItem = readRecord(afterPaths[path]);

    for (const method of HTTP_METHODS) {
      if (!isRecord(beforePathItem[method])) {
        continue;
      }

      if (!isRecord(afterPathItem[method])) {
        changes.push(`paths.${path}.${method} was removed`);
        continue;
      }

      compareOperation(beforePathItem, afterPathItem, method, path, changes);
    }
  }

  const beforeSchemas = readRecord(readRecord(before["components"])["schemas"]);
  const afterSchemas = readRecord(readRecord(after["components"])["schemas"]);

  for (const [schemaName, beforeSchema] of Object.entries(beforeSchemas)) {
    if (!Object.hasOwn(afterSchemas, schemaName)) {
      changes.push(`components.schemas.${schemaName} was removed`);
      continue;
    }

    compareSchema(
      beforeSchema,
      afterSchemas[schemaName],
      `components.schemas.${schemaName}`,
      changes,
    );
  }

  return [...new Set(changes)].sort();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function validateOpenApiBreakingChangeApproval(
  value: unknown,
  expectedBaselineSha256: string,
): string[] {
  if (!isRecord(value)) {
    return ["approval must be an object"];
  }

  const approval = value as Partial<OpenApiBreakingChangeApproval>;
  const errors: string[] = [];

  if (approval.baselineSha256 !== expectedBaselineSha256) {
    errors.push("baselineSha256 must match the normalized base OpenAPI digest");
  }

  if (typeof approval.change !== "string" || approval.change.length === 0) {
    errors.push("change must name one exact breaking-diff finding");
  }

  if (
    typeof approval.issue !== "string" ||
    !/^https:\/\/github\.com\/langgenius\/mosoo\/issues\/\d+$/.test(approval.issue)
  ) {
    errors.push("issue must link to a langgenius/mosoo compatibility decision");
  }

  if (
    typeof approval.minimumClientVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(approval.minimumClientVersion)
  ) {
    errors.push("minimumClientVersion must be a semantic version");
  }

  if (
    typeof approval.compatibilityStartedAt !== "string" ||
    !isIsoDate(approval.compatibilityStartedAt)
  ) {
    errors.push("compatibilityStartedAt must be an ISO date");
  }

  if (typeof approval.enforcementDate !== "string" || !isIsoDate(approval.enforcementDate)) {
    errors.push("enforcementDate must be an ISO date");
  }

  if (
    typeof approval.compatibilityStartedAt === "string" &&
    typeof approval.enforcementDate === "string" &&
    approval.enforcementDate <= approval.compatibilityStartedAt
  ) {
    errors.push("enforcementDate must be after compatibilityStartedAt");
  }

  return errors;
}
