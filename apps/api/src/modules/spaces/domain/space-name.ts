import { getSpaceNameValidationError } from "@mosoo/contracts/space";

import { isTruthy } from "../../../shared/truthiness";
export function normalizeSpaceName(name: string): string {
  if (!name) {
    throw new Error("Space name is required.");
  }

  const validationError = getSpaceNameValidationError(name);

  if (isTruthy(validationError)) {
    throw new Error(validationError);
  }

  return name;
}
