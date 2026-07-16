import { describe, expect, test } from "bun:test";

import { shouldSubmitLoginInput } from "../src/routes/login/login-keyboard";

describe("login input keyboard handling", () => {
  test("submits only a regular Enter keydown", () => {
    expect(
      shouldSubmitLoginInput({
        isComposing: false,
        key: "Enter",
        keyCode: 13,
      }),
    ).toBe(true);
    expect(
      shouldSubmitLoginInput({
        isComposing: false,
        key: "a",
        keyCode: 65,
      }),
    ).toBe(false);
  });

  test("does not submit when Enter confirms IME composition", () => {
    expect(
      shouldSubmitLoginInput({
        isComposing: true,
        key: "Enter",
        keyCode: 13,
      }),
    ).toBe(false);
    expect(
      shouldSubmitLoginInput({
        isComposing: false,
        key: "Enter",
        keyCode: 229,
      }),
    ).toBe(false);
  });
});
