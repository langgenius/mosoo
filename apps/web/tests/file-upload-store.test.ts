import { describe, expect, test } from "bun:test";

import { mergeUploadedPart } from "../src/domains/file/file-upload.store";

describe("mergeUploadedPart", () => {
  test("inserts a part while preserving ascending part order", () => {
    expect(
      mergeUploadedPart(
        [
          { etag: "part-1", partNumber: 1 },
          { etag: "part-3", partNumber: 3 },
        ],
        { etag: "part-2", partNumber: 2 },
      ),
    ).toEqual([
      { etag: "part-1", partNumber: 1 },
      { etag: "part-2", partNumber: 2 },
      { etag: "part-3", partNumber: 3 },
    ]);
  });

  test("replaces an existing uploaded part", () => {
    expect(
      mergeUploadedPart(
        [
          { etag: "part-1", partNumber: 1 },
          { etag: "stale-part-2", partNumber: 2 },
          { etag: "part-3", partNumber: 3 },
        ],
        { etag: "fresh-part-2", partNumber: 2 },
      ),
    ).toEqual([
      { etag: "part-1", partNumber: 1 },
      { etag: "fresh-part-2", partNumber: 2 },
      { etag: "part-3", partNumber: 3 },
    ]);
  });

  test("normalizes unexpectedly unsorted existing parts", () => {
    expect(
      mergeUploadedPart(
        [
          { etag: "part-3", partNumber: 3 },
          { etag: "part-1", partNumber: 1 },
        ],
        { etag: "part-2", partNumber: 2 },
      ),
    ).toEqual([
      { etag: "part-1", partNumber: 1 },
      { etag: "part-2", partNumber: 2 },
      { etag: "part-3", partNumber: 3 },
    ]);
  });
});
