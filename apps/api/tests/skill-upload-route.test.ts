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

describe("Skill upload routes", () => {
  test.each(["/skill/inspect", "/skill/package"])(
    "%s rejects an oversized file before copying it",
    async (path) => {
      const database = await createPublicHttpContractDatabase();
      const form = new FormData();
      form.set("projectId", PUBLIC_API_TEST_IDS.project);
      form.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.zip"));
      const copies = spyOn(Blob.prototype, "arrayBuffer");

      try {
        const response = await requestPublicApiWithBindings(
          createHttpApp(),
          new Request(`https://api.example.com${PUBLIC_API_PREFIX}${path}`, {
            body: form,
            headers: { Authorization: `Bearer ${TOKENS.owner}` },
            method: "POST",
          }),
          createPublicHttpTestBindings(database) as ApiBindings,
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "File exceeds the limit (10 MB)." });
        expect(copies).not.toHaveBeenCalled();
      } finally {
        copies.mockRestore();
      }
    },
  );
});
