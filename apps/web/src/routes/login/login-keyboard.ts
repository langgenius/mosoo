interface LoginInputKey {
  readonly isComposing: boolean;
  readonly key: string;
  readonly keyCode: number;
}

export function shouldSubmitLoginInput(input: LoginInputKey): boolean {
  return input.key === "Enter" && !input.isComposing && input.keyCode !== 229;
}
