export function graphQLEnumValues(values: readonly string[]): string {
  return values.join("\n    ");
}
