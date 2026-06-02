type Falsy = "" | 0 | false | null | undefined;

export function isTruthy<T>(value: T): value is Exclude<T, Falsy> {
  return Boolean(value);
}
