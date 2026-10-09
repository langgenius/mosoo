import { describe, expect, spyOn, test } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
  TOKENS,
} from "./helpers/public-api-http-test-fixture";
import { requestPublicApiWithBindings } from "./public-thread-api-fixtures";

describe("HTTP request logging", () => {
  test("does not log the request body that a client error quotes", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const spies = (["debug", "error", "info", "log", "warn"] as const).map((method) =>
      spyOn(console, method).mockImplementation(() => {}),
    );

    try {
      const response = await requestPublicApiWithBindings(
        createHttpApp(),
        new Request(
          `https://api.example.com${PUBLIC_API_PREFIX}/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          {
            body: "privatebodymarker",
            headers: {
              Authorization: `Bearer ${TOKENS.owner}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          },
        ),
        bindings,
      );
      const logged = spies.flatMap((spy) =>
        spy.mock.calls.map((args) => args.map((arg) => String(arg)).join(" ")),
      );

      expect(response.status).toBe(400);
      expect(logged.some((line) => line.includes("http.request"))).toBe(true);
      expect(logged.filter((line) => line.includes("privatebodymarker"))).toEqual([]);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
