import { describe, expect, test } from "bun:test";

import { preventAutomaticOutboundRedirects } from "../src/adapters/durable-objects/sandbox-container-proxy-request";

describe("sandbox ContainerProxy", () => {
  test("returns redirects to the container so every hop is intercepted", () => {
    const request = new Request("https://allowed.example/redirect", {
      headers: { "x-egress-test": "preserved" },
    });

    const guarded = preventAutomaticOutboundRedirects(request);

    expect(guarded).not.toBe(request);
    expect(guarded.redirect).toBe("manual");
    expect(guarded.url).toBe(request.url);
    expect(guarded.headers.get("x-egress-test")).toBe("preserved");
  });

  test("preserves an outbound POST body while disabling automatic redirects", async () => {
    const request = new Request("https://allowed.example/model", {
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        "x-egress-test": "preserved",
      },
      method: "POST",
    });

    const guarded = preventAutomaticOutboundRedirects(request);

    expect(guarded.method).toBe("POST");
    expect(guarded.headers.get("content-type")).toBe("application/json");
    expect(guarded.headers.get("x-egress-test")).toBe("preserved");
    expect(await guarded.text()).toBe('{"prompt":"hello"}');
  });

  test("preserves stricter or already-manual redirect modes", () => {
    const manual = new Request("https://allowed.example/manual", { redirect: "manual" });
    const error = new Request("https://allowed.example/error", { redirect: "error" });

    expect(preventAutomaticOutboundRedirects(manual)).toBe(manual);
    expect(preventAutomaticOutboundRedirects(error)).toBe(error);
  });
});
